use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;

pub const BATTERY_SLEEP_PREFERENCE_FILE: &str = "battery-sleep-preference.json";
pub const BATTERY_SLEEP_THRESHOLD_PERCENT: u8 = 10;
pub const BATTERY_SLEEP_EVENT_NAME: &str = "agent-halo://battery-sleep-status";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    pub is_battery_powered: bool,
    pub percentage: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatterySleepStatus {
    pub supported: bool,
    pub armed: bool,
    pub error: Option<String>,
    pub battery_level: Option<u8>,
    pub is_battery_powered: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatterySleepPreference {
    pub armed: bool,
}

pub trait PowerSourceProvider: Send + Sync {
    fn query_power_status(&self) -> Result<Option<BatteryStatus>, String>;
}

pub trait SleepRequester: Send + Sync {
    fn request_sleep(&self) -> Result<(), String>;
}

pub trait PreferenceStore: Send + Sync {
    fn read_armed(&self) -> Result<bool, String>;
    fn write_armed(&self, armed: bool) -> Result<(), String>;
}

pub trait NotificationController: Send + Sync {
    fn start(&self, callback: Arc<dyn Fn() + Send + Sync + 'static>) -> Result<(), String>;
    fn stop(&self);
}

pub struct DiskPreferenceStore {
    path: PathBuf,
}

impl DiskPreferenceStore {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join(BATTERY_SLEEP_PREFERENCE_FILE),
        }
    }
}

impl PreferenceStore for DiskPreferenceStore {
    fn read_armed(&self) -> Result<bool, String> {
        if !self.path.exists() {
            return Ok(false);
        }
        let contents = fs::read_to_string(&self.path)
            .map_err(|e| format!("Failed to read battery sleep preference: {e}"))?;
        let pref: BatterySleepPreference = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse battery sleep preference: {e}"))?;
        Ok(pref.armed)
    }

    fn write_armed(&self, armed: bool) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Invalid preference path".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
        let temp_path = self.path.with_extension("json.tmp");
        let pref = BatterySleepPreference { armed };
        let contents = serde_json::to_vec_pretty(&pref)
            .map_err(|e| format!("Failed to serialize preference: {e}"))?;

        // 1. Create and write temp file
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temporary preference: {e}"))?;
        file.write_all(&contents)
            .map_err(|e| format!("Failed to write temporary preference: {e}"))?;

        // 2. Sync temp file to disk before rename (fail closed on sync errors)
        file.sync_all()
            .map_err(|e| format!("Failed to sync temporary preference: {e}"))?;
        drop(file);

        // 3. Atomically rename
        fs::rename(&temp_path, &self.path)
            .map_err(|e| format!("Failed to save preference: {e}"))?;

        // 4. Sync parent directory to persist directory entry
        let parent_dir = fs::File::open(parent)
            .map_err(|e| format!("Failed to open config dir for sync: {e}"))?;
        parent_dir
            .sync_all()
            .map_err(|e| format!("Failed to sync config dir: {e}"))?;

        Ok(())
    }
}

pub struct BatterySleepEngine {
    op_mutex: Mutex<()>,
    inner: Mutex<BatterySleepEngineInner>,
    power_provider: Arc<dyn PowerSourceProvider>,
    sleep_requester: Arc<dyn SleepRequester>,
    preference_store: Arc<dyn PreferenceStore>,
    notification_controller: Arc<dyn NotificationController>,
    emitter: Arc<dyn Fn(BatterySleepStatus) + Send + Sync + 'static>,
}

#[derive(Debug, Default)]
struct BatterySleepEngineInner {
    armed: bool,
    error: Option<String>,
}

impl BatterySleepEngine {
    pub fn new(
        power_provider: Arc<dyn PowerSourceProvider>,
        sleep_requester: Arc<dyn SleepRequester>,
        preference_store: Arc<dyn PreferenceStore>,
        notification_controller: Arc<dyn NotificationController>,
        emitter: Arc<dyn Fn(BatterySleepStatus) + Send + Sync + 'static>,
    ) -> Arc<Self> {
        let engine = Arc::new(Self {
            op_mutex: Mutex::new(()),
            inner: Mutex::new(BatterySleepEngineInner::default()),
            power_provider,
            sleep_requester,
            preference_store,
            notification_controller,
            emitter,
        });

        engine.initialize();
        engine
    }

    fn initialize(self: &Arc<Self>) {
        let _op = self.op_mutex.lock().unwrap_or_else(|e| e.into_inner());
        let power_res = self.power_provider.query_power_status();
        let is_supported = matches!(power_res, Ok(Some(_)));

        if !is_supported {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = false;
            return;
        }

        let armed_pref = self.preference_store.read_armed().unwrap_or(false);
        if armed_pref {
            {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.armed = true;
            }

            let weak = Arc::downgrade(self);
            if let Err(e) = self.notification_controller.start(Arc::new(move || {
                if let Some(eng) = weak.upgrade() {
                    eng.handle_power_change();
                }
            })) {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.armed = false;
                inner.error = Some(format!("Failed to start power notifications: {e}"));
                let _ = self.preference_store.write_armed(false);
                return;
            }

            // Handle already low on arm/startup
            if let Ok(Some(power)) = self.power_provider.query_power_status() {
                if power.is_battery_powered && power.percentage < BATTERY_SLEEP_THRESHOLD_PERCENT {
                    self.consume_and_sleep_locked();
                }
            }
        }
    }

    fn get_status_locked(&self) -> BatterySleepStatus {
        let (armed, error) = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (inner.armed, inner.error.clone())
        };
        let power_res = self.power_provider.query_power_status();
        let (supported, battery_level, is_battery_powered) = match power_res {
            Ok(Some(status)) => (
                true,
                Some(status.percentage),
                Some(status.is_battery_powered),
            ),
            Ok(None) => (false, None, None),
            Err(_) => (false, None, None),
        };

        BatterySleepStatus {
            supported,
            armed,
            error,
            battery_level,
            is_battery_powered,
        }
    }

    pub fn get_status(&self) -> BatterySleepStatus {
        let _op = self.op_mutex.lock().unwrap_or_else(|e| e.into_inner());
        self.get_status_locked()
    }

    pub fn set_armed(
        self: &Arc<Self>,
        requested_armed: bool,
    ) -> Result<BatterySleepStatus, String> {
        let _op = self.op_mutex.lock().unwrap_or_else(|e| e.into_inner());

        if !requested_armed {
            // (5) OFF must work even when battery query fails; do OFF before query!
            self.preference_store.write_armed(false)?;
            self.notification_controller.stop();
            {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.armed = false;
                inner.error = None;
            }
            let power_opt = self.power_provider.query_power_status().ok().flatten();
            let status = BatterySleepStatus {
                supported: power_opt.is_some(),
                armed: false,
                error: None,
                battery_level: power_opt.as_ref().map(|p| p.percentage),
                is_battery_powered: power_opt.as_ref().map(|p| p.is_battery_powered),
            };
            (self.emitter)(status.clone());
            return Ok(status);
        }

        // Turning ON requires valid power source support
        let power_res = self.power_provider.query_power_status()?;
        let Some(power) = power_res else {
            return Err(
                "Battery sleep is only supported on battery-equipped macOS devices".to_string(),
            );
        };

        if let Err(e) = self.preference_store.write_armed(true) {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = false;
            inner.error = Some(format!("Failed to persist armed state: {e}"));
            let status = BatterySleepStatus {
                supported: true,
                armed: false,
                error: inner.error.clone(),
                battery_level: Some(power.percentage),
                is_battery_powered: Some(power.is_battery_powered),
            };
            (self.emitter)(status);
            return Err(e);
        }

        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = true;
            inner.error = None;
        }

        let weak = Arc::downgrade(self);
        if let Err(e) = self.notification_controller.start(Arc::new(move || {
            if let Some(eng) = weak.upgrade() {
                eng.handle_power_change();
            }
        })) {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = false;
            inner.error = Some(format!("Failed to start power notifications: {e}"));
            let _ = self.preference_store.write_armed(false);
            let status = BatterySleepStatus {
                supported: true,
                armed: false,
                error: inner.error.clone(),
                battery_level: Some(power.percentage),
                is_battery_powered: Some(power.is_battery_powered),
            };
            (self.emitter)(status);
            return Err(e);
        }

        let status = BatterySleepStatus {
            supported: true,
            armed: true,
            error: None,
            battery_level: Some(power.percentage),
            is_battery_powered: Some(power.is_battery_powered),
        };
        (self.emitter)(status.clone());

        // Handle already-low on arm
        if power.is_battery_powered && power.percentage < BATTERY_SLEEP_THRESHOLD_PERCENT {
            self.consume_and_sleep_locked();
            return Ok(self.get_status_locked());
        }

        Ok(status)
    }

    pub fn handle_power_change(self: &Arc<Self>) {
        let _op = self.op_mutex.lock().unwrap_or_else(|e| e.into_inner());

        {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if !inner.armed {
                return;
            }
        }

        let power = match self.power_provider.query_power_status() {
            Ok(Some(status)) => status,
            Ok(None) => return,
            Err(e) => {
                // (1) Update error and drop inner lock BEFORE get_status => no deadlock!
                {
                    let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    inner.error = Some(format!("Failed to query power status: {e}"));
                }
                let status = self.get_status_locked();
                (self.emitter)(status);
                return;
            }
        };

        if power.is_battery_powered && power.percentage < BATTERY_SLEEP_THRESHOLD_PERCENT {
            self.consume_and_sleep_locked();
        }
    }

    fn consume_and_sleep_locked(self: &Arc<Self>) {
        // (2) Atomically check armed inside consume
        {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if !inner.armed {
                return;
            }
        }

        // Re-query live power under op_mutex
        let live_power = match self.power_provider.query_power_status() {
            Ok(Some(status))
                if status.is_battery_powered
                    && status.percentage < BATTERY_SLEEP_THRESHOLD_PERCENT =>
            {
                status
            }
            _ => return,
        };

        // Step 1: Durably disarm on disk BEFORE requesting system sleep
        if let Err(persist_err) = self.preference_store.write_armed(false) {
            // Persistence failure => NO SLEEP!
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.error = Some(format!(
                "Persistence failure disarming sleep: {persist_err}"
            ));
            drop(inner);
            let status = self.get_status_locked();
            (self.emitter)(status);
            return;
        }

        // Step 2: Disarm in-memory
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = false;
        }

        // Step 3: Cleanup event source
        self.notification_controller.stop();

        // Step 4: Emit state to UI before sleep
        let status_before_sleep = BatterySleepStatus {
            supported: true,
            armed: false,
            error: None,
            battery_level: Some(live_power.percentage),
            is_battery_powered: Some(live_power.is_battery_powered),
        };
        (self.emitter)(status_before_sleep);

        // Step 5: Request system sleep via native trusted API
        if let Err(sleep_err) = self.sleep_requester.request_sleep() {
            // Failed sleep must stay disarmed with visible error and manual rearm only
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.armed = false;
            inner.error = Some(format!("System sleep failed: {sleep_err}"));
            drop(inner);
            let status = self.get_status_locked();
            (self.emitter)(status);
        }
    }
}

impl Drop for BatterySleepEngine {
    fn drop(&mut self) {
        self.notification_controller.stop();
    }
}

// ---------------------------------------------------------------------------
// macOS Native Implementations
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::{
        array::CFArrayRef,
        base::{CFTypeRef, TCFType},
        dictionary::CFDictionaryRef,
        runloop::CFRunLoopRef,
        string::{CFString, CFStringRef},
    };
    use std::os::raw::c_void;

    pub type IOPowerSourceCallbackType = extern "C" fn(context: *mut c_void);

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        pub fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
        pub fn IOPSCopyPowerSourcesList(blob: CFTypeRef) -> CFArrayRef;
        pub fn IOPSGetPowerSourceDescription(blob: CFTypeRef, ps: CFTypeRef) -> CFDictionaryRef;
        pub fn IOPSNotificationCreateRunLoopSource(
            callback: IOPowerSourceCallbackType,
            context: *mut c_void,
        ) -> CFTypeRef;

        pub fn IOPMFindPowerManagement(master_device_port: u32) -> u32;
        pub fn IOPMSleepSystem(connect: u32) -> i32;
        pub fn IOServiceClose(connect: u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        pub static kCFRunLoopCommonModes: CFStringRef;
        pub fn CFRunLoopGetMain() -> CFRunLoopRef;
        pub fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFTypeRef, mode: CFStringRef);
        pub fn CFRunLoopRemoveSource(rl: CFRunLoopRef, source: CFTypeRef, mode: CFStringRef);
        pub fn CFRelease(cf: CFTypeRef);
        pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
        pub fn CFArrayGetCount(array: CFArrayRef) -> isize;
        pub fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> CFTypeRef;
        pub fn CFNumberGetValue(number: CFTypeRef, the_type: isize, value_ptr: *mut c_void)
            -> bool;
        pub fn CFBooleanGetValue(boolean: CFTypeRef) -> bool;
        pub fn CFEqual(cf1: CFTypeRef, cf2: CFTypeRef) -> bool;
    }

    pub fn query_power_status() -> Result<Option<super::BatteryStatus>, String> {
        unsafe {
            let blob = IOPSCopyPowerSourcesInfo();
            if blob.is_null() {
                return Err("IOPSCopyPowerSourcesInfo returned null".to_string());
            }

            let list = IOPSCopyPowerSourcesList(blob);
            if list.is_null() {
                CFRelease(blob);
                return Ok(None);
            }

            let count = CFArrayGetCount(list);
            if count <= 0 {
                CFRelease(list as CFTypeRef);
                CFRelease(blob);
                return Ok(None);
            }

            let key_ps_state = CFString::new("Power Source State");
            let key_cur_cap = CFString::new("Current Capacity");
            let key_max_cap = CFString::new("Max Capacity");
            let key_is_present = CFString::new("Is Present");
            let key_type = CFString::new("Type");
            let val_battery_type = CFString::new("InternalBattery");
            let val_battery_state = CFString::new("Battery Power");

            let mut found_battery: Option<super::BatteryStatus> = None;

            for i in 0..count {
                let ps = CFArrayGetValueAtIndex(list, i);
                let desc = IOPSGetPowerSourceDescription(blob, ps);
                if desc.is_null() {
                    continue;
                }

                let is_present_val = CFDictionaryGetValue(desc, key_is_present.as_CFTypeRef());
                if !is_present_val.is_null() && !CFBooleanGetValue(is_present_val) {
                    continue;
                }

                let type_val = CFDictionaryGetValue(desc, key_type.as_CFTypeRef());
                if !type_val.is_null() && !CFEqual(type_val, val_battery_type.as_CFTypeRef()) {
                    continue;
                }

                let state_val = CFDictionaryGetValue(desc, key_ps_state.as_CFTypeRef());
                let is_battery_powered = if !state_val.is_null() {
                    CFEqual(state_val, val_battery_state.as_CFTypeRef())
                } else {
                    false
                };

                let mut cur_cap: i32 = 0;
                let cur_val = CFDictionaryGetValue(desc, key_cur_cap.as_CFTypeRef());
                let has_cur = if !cur_val.is_null() {
                    CFNumberGetValue(
                        cur_val,
                        3, // kCFNumberSInt32Type
                        &mut cur_cap as *mut i32 as *mut std::os::raw::c_void,
                    )
                } else {
                    false
                };

                let mut max_cap: i32 = 0;
                let max_val = CFDictionaryGetValue(desc, key_max_cap.as_CFTypeRef());
                let has_max = if !max_val.is_null() {
                    CFNumberGetValue(
                        max_val,
                        3, // kCFNumberSInt32Type
                        &mut max_cap as *mut i32 as *mut std::os::raw::c_void,
                    )
                } else {
                    false
                };

                // (7) If native needs type/value validation, fail closed rather than default guessed capacities!
                if !has_cur || !has_max || max_cap <= 0 || cur_cap < 0 {
                    continue;
                }

                let percentage = ((cur_cap as f64 / max_cap as f64) * 100.0)
                    .round()
                    .clamp(0.0, 100.0) as u8;

                found_battery = Some(super::BatteryStatus {
                    is_battery_powered,
                    percentage,
                });
                break;
            }

            CFRelease(list as CFTypeRef);
            CFRelease(blob);

            Ok(found_battery)
        }
    }

    pub fn sleep_system() -> Result<(), String> {
        unsafe {
            let connect = IOPMFindPowerManagement(0);
            if connect == 0 {
                return Err("Failed to find power management service".to_string());
            }
            let ret = IOPMSleepSystem(connect);
            IOServiceClose(connect);
            if ret == 0 {
                Ok(())
            } else {
                Err(format!("IOPMSleepSystem returned error code {ret}"))
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub struct MacPowerSourceProvider;

#[cfg(target_os = "macos")]
impl PowerSourceProvider for MacPowerSourceProvider {
    fn query_power_status(&self) -> Result<Option<BatteryStatus>, String> {
        platform::query_power_status()
    }
}

#[cfg(target_os = "macos")]
pub struct MacSleepRequester;

#[cfg(target_os = "macos")]
impl SleepRequester for MacSleepRequester {
    fn request_sleep(&self) -> Result<(), String> {
        platform::sleep_system()
    }
}

#[cfg(target_os = "macos")]
struct CallbackHolder {
    callback: Arc<dyn Fn() + Send + Sync + 'static>,
}

#[cfg(target_os = "macos")]
extern "C" fn power_source_run_loop_callback(context: *mut std::os::raw::c_void) {
    if context.is_null() {
        return;
    }
    // (3) Callback must clone its Arc BEFORE invoking so self-stop is safe!
    let callback = unsafe {
        let holder = &*(context as *const CallbackHolder);
        Arc::clone(&holder.callback)
    };
    callback();
}

#[cfg(target_os = "macos")]
struct NativeActiveSource {
    source: core_foundation::base::CFTypeRef,
    holder: *mut CallbackHolder,
}

#[cfg(target_os = "macos")]
unsafe impl Send for NativeActiveSource {}
#[cfg(target_os = "macos")]
unsafe impl Sync for NativeActiveSource {}

#[cfg(target_os = "macos")]
pub struct MacNotificationController {
    active: Mutex<Option<NativeActiveSource>>,
}

#[cfg(target_os = "macos")]
impl Default for MacNotificationController {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }
}

#[cfg(target_os = "macos")]
impl NotificationController for MacNotificationController {
    fn start(&self, callback: Arc<dyn Fn() + Send + Sync + 'static>) -> Result<(), String> {
        self.stop();

        let holder = Box::into_raw(Box::new(CallbackHolder { callback }));
        let source = unsafe {
            platform::IOPSNotificationCreateRunLoopSource(
                power_source_run_loop_callback,
                holder as *mut std::os::raw::c_void,
            )
        };

        if source.is_null() {
            unsafe {
                let _ = Box::from_raw(holder);
            }
            return Err("IOPSNotificationCreateRunLoopSource returned null".to_string());
        }

        unsafe {
            let main_rl = platform::CFRunLoopGetMain();
            platform::CFRunLoopAddSource(main_rl, source, platform::kCFRunLoopCommonModes);
        }

        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        *active = Some(NativeActiveSource { source, holder });
        Ok(())
    }

    fn stop(&self) {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(active_src) = active.take() {
            unsafe {
                let main_rl = platform::CFRunLoopGetMain();
                platform::CFRunLoopRemoveSource(
                    main_rl,
                    active_src.source,
                    platform::kCFRunLoopCommonModes,
                );
                platform::CFRelease(active_src.source);
                let _ = Box::from_raw(active_src.holder);
            }
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for MacNotificationController {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// Non-macOS Fallback
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "macos"))]
pub struct NonMacPowerSourceProvider;

#[cfg(not(target_os = "macos"))]
impl PowerSourceProvider for NonMacPowerSourceProvider {
    fn query_power_status(&self) -> Result<Option<BatteryStatus>, String> {
        Ok(None)
    }
}

#[cfg(not(target_os = "macos"))]
pub struct NonMacSleepRequester;

#[cfg(not(target_os = "macos"))]
impl SleepRequester for NonMacSleepRequester {
    fn request_sleep(&self) -> Result<(), String> {
        Err("System sleep is only supported on macOS".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct NonMacNotificationController;

#[cfg(not(target_os = "macos"))]
impl NotificationController for NonMacNotificationController {
    fn start(&self, _callback: Arc<dyn Fn() + Send + Sync + 'static>) -> Result<(), String> {
        Err("Power notifications are only supported on macOS".to_string())
    }
    fn stop(&self) {}
}

// ---------------------------------------------------------------------------
// Tauri State Holder
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct BatterySleepState {
    engine: Arc<Mutex<Option<Arc<BatterySleepEngine>>>>,
}

impl BatterySleepState {
    pub fn initialize(&self, app: &tauri::AppHandle) {
        let Ok(config_dir) = app.path().app_config_dir() else {
            return;
        };

        let app_handle = app.clone();
        let emitter: Arc<dyn Fn(BatterySleepStatus) + Send + Sync + 'static> =
            Arc::new(move |status| {
                use tauri::Emitter;
                let _ = app_handle.emit(BATTERY_SLEEP_EVENT_NAME, status);
            });

        let pref_store = Arc::new(DiskPreferenceStore::new(&config_dir));

        #[cfg(target_os = "macos")]
        let (power_provider, sleep_requester, notif_ctrl): (
            Arc<dyn PowerSourceProvider>,
            Arc<dyn SleepRequester>,
            Arc<dyn NotificationController>,
        ) = (
            Arc::new(MacPowerSourceProvider),
            Arc::new(MacSleepRequester),
            Arc::new(MacNotificationController::default()),
        );

        #[cfg(not(target_os = "macos"))]
        let (power_provider, sleep_requester, notif_ctrl): (
            Arc<dyn PowerSourceProvider>,
            Arc<dyn SleepRequester>,
            Arc<dyn NotificationController>,
        ) = (
            Arc::new(NonMacPowerSourceProvider),
            Arc::new(NonMacSleepRequester),
            Arc::new(NonMacNotificationController::default()),
        );

        let engine = BatterySleepEngine::new(
            power_provider,
            sleep_requester,
            pref_store,
            notif_ctrl,
            emitter,
        );

        let mut lock = self.engine.lock().unwrap_or_else(|e| e.into_inner());
        *lock = Some(engine);
    }

    pub fn get_status(&self) -> BatterySleepStatus {
        let lock = self.engine.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(engine) = lock.as_ref() {
            engine.get_status()
        } else {
            BatterySleepStatus {
                supported: false,
                armed: false,
                error: None,
                battery_level: None,
                is_battery_powered: None,
            }
        }
    }

    // Called on the main run loop during app exit, without changing the saved
    // one-shot preference. Break the app-handle/emitter cycle and release IOKit.
    pub fn shutdown(&self) {
        let engine = self.engine.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(engine) = engine {
            engine.notification_controller.stop();
        }
    }

    pub fn set_armed(&self, armed: bool) -> Result<BatterySleepStatus, String> {
        let lock = self.engine.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(engine) = lock.as_ref() {
            let engine = engine.clone();
            drop(lock);
            engine.set_armed(armed)
        } else {
            Err("Battery sleep engine is not initialized".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Unit Tests with Fake/Mock Dependencies
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn main_window_can_subscribe_without_renderer_emission_or_pet_access() {
        // Browser IPC mocks cannot establish the installed app's event ACL.
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/battery-sleep.json")).unwrap();
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["core:event:allow-listen", "core:event:allow-unlisten"])
        );
    }

    #[test]
    fn disk_preference_roundtrip_uses_real_sync_without_live_preferences() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "battery-sleep-store-test-{}-{nonce}",
                std::process::id()
            ));
        let store = DiskPreferenceStore::new(&dir);
        assert!(!store.read_armed().unwrap());
        store.write_armed(true).expect("sync armed preference");
        assert!(store.read_armed().unwrap());
        store.write_armed(false).expect("sync disarmed preference");
        assert!(!DiskPreferenceStore::new(&dir).read_armed().unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_power_query_is_read_only_and_well_formed() {
        // Exercise the real FFI, not the mock. Never arm, write preferences,
        // install a notification source, or request sleep in this smoke test.
        let snapshot = platform::query_power_status().expect("native power query");
        if let Some(power) = snapshot {
            assert!(power.percentage <= 100);
            eprintln!("Native battery snapshot: {power:?}");
        }
    }

    struct MockPowerProvider {
        status: Mutex<Result<Option<BatteryStatus>, String>>,
    }

    impl MockPowerProvider {
        fn new(status: Result<Option<BatteryStatus>, String>) -> Self {
            Self {
                status: Mutex::new(status),
            }
        }

        fn set_status(&self, status: Result<Option<BatteryStatus>, String>) {
            *self.status.lock().unwrap() = status;
        }
    }

    impl PowerSourceProvider for MockPowerProvider {
        fn query_power_status(&self) -> Result<Option<BatteryStatus>, String> {
            self.status.lock().unwrap().clone()
        }
    }

    struct MockSleepRequester {
        sleep_calls: Mutex<usize>,
        result: Mutex<Result<(), String>>,
    }

    impl MockSleepRequester {
        fn new(result: Result<(), String>) -> Self {
            Self {
                sleep_calls: Mutex::new(0),
                result: Mutex::new(result),
            }
        }

        fn sleep_calls(&self) -> usize {
            *self.sleep_calls.lock().unwrap()
        }
    }

    impl SleepRequester for MockSleepRequester {
        fn request_sleep(&self) -> Result<(), String> {
            let mut calls = self.sleep_calls.lock().unwrap();
            *calls += 1;
            self.result.lock().unwrap().clone()
        }
    }

    struct MockPreferenceStore {
        armed: Mutex<Result<bool, String>>,
        write_fail_on_false: Mutex<bool>,
        write_calls: Mutex<Vec<bool>>,
    }

    impl MockPreferenceStore {
        fn new(initial_armed: bool) -> Self {
            Self {
                armed: Mutex::new(Ok(initial_armed)),
                write_fail_on_false: Mutex::new(false),
                write_calls: Mutex::new(Vec::new()),
            }
        }

        fn write_calls(&self) -> Vec<bool> {
            self.write_calls.lock().unwrap().clone()
        }
    }

    impl PreferenceStore for MockPreferenceStore {
        fn read_armed(&self) -> Result<bool, String> {
            self.armed.lock().unwrap().clone()
        }

        fn write_armed(&self, armed: bool) -> Result<(), String> {
            if !armed && *self.write_fail_on_false.lock().unwrap() {
                return Err("Simulated disk write failure for disarm".to_string());
            }
            self.write_calls.lock().unwrap().push(armed);
            *self.armed.lock().unwrap() = Ok(armed);
            Ok(())
        }
    }

    struct MockNotificationController {
        started: Mutex<bool>,
        stopped: Mutex<bool>,
        callback: Mutex<Option<Arc<dyn Fn() + Send + Sync + 'static>>>,
    }

    impl MockNotificationController {
        fn new() -> Self {
            Self {
                started: Mutex::new(false),
                stopped: Mutex::new(false),
                callback: Mutex::new(None),
            }
        }

        fn trigger_callback(&self) {
            let cb = self.callback.lock().unwrap().clone();
            if let Some(cb) = cb {
                cb();
            }
        }

        fn is_started(&self) -> bool {
            *self.started.lock().unwrap()
        }
    }

    impl NotificationController for MockNotificationController {
        fn start(&self, callback: Arc<dyn Fn() + Send + Sync + 'static>) -> Result<(), String> {
            *self.started.lock().unwrap() = true;
            *self.stopped.lock().unwrap() = false;
            *self.callback.lock().unwrap() = Some(callback);
            Ok(())
        }

        fn stop(&self) {
            *self.started.lock().unwrap() = false;
            *self.stopped.lock().unwrap() = true;
            *self.callback.lock().unwrap() = None;
        }
    }

    fn setup_test_engine(
        initial_power: BatteryStatus,
        initial_pref_armed: bool,
    ) -> (
        Arc<BatterySleepEngine>,
        Arc<MockPowerProvider>,
        Arc<MockSleepRequester>,
        Arc<MockPreferenceStore>,
        Arc<MockNotificationController>,
        Arc<Mutex<Vec<BatterySleepStatus>>>,
    ) {
        let power_provider = Arc::new(MockPowerProvider::new(Ok(Some(initial_power))));
        let sleep_requester = Arc::new(MockSleepRequester::new(Ok(())));
        let pref_store = Arc::new(MockPreferenceStore::new(initial_pref_armed));
        let notif_ctrl = Arc::new(MockNotificationController::new());
        let emitted_events = Arc::new(Mutex::new(Vec::new()));

        let emitted_clone = emitted_events.clone();
        let emitter: Arc<dyn Fn(BatterySleepStatus) + Send + Sync + 'static> =
            Arc::new(move |status| {
                emitted_clone.lock().unwrap().push(status);
            });

        let engine = BatterySleepEngine::new(
            power_provider.clone(),
            sleep_requester.clone(),
            pref_store.clone(),
            notif_ctrl.clone(),
            emitter,
        );

        (
            engine,
            power_provider,
            sleep_requester,
            pref_store,
            notif_ctrl,
            emitted_events,
        )
    }

    #[test]
    fn test_ac_power_does_not_sleep() {
        let (engine, power_provider, sleep_req, _, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: false, // On AC power
                percentage: 5,             // below 10%
            },
            false,
        );

        let status = engine.set_armed(true).expect("arm should succeed");
        assert!(status.armed);
        assert_eq!(sleep_req.sleep_calls(), 0);

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: false,
            percentage: 4,
        })));
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 0);
        assert!(engine.get_status().armed);
    }

    #[test]
    fn test_exactly_10_percent_does_not_sleep() {
        let (engine, power_provider, sleep_req, _, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 50,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");
        assert_eq!(sleep_req.sleep_calls(), 0);

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 10,
        })));
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 0);
        assert!(engine.get_status().armed);
    }

    #[test]
    fn test_below_10_percent_sleeps_and_disarms() {
        let (engine, power_provider, sleep_req, pref_store, notif_ctrl, emitted) =
            setup_test_engine(
                BatteryStatus {
                    is_battery_powered: true,
                    percentage: 50,
                },
                false,
            );

        engine.set_armed(true).expect("arm should succeed");
        assert_eq!(sleep_req.sleep_calls(), 0);
        assert!(notif_ctrl.is_started());

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 9,
        })));
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 1);
        assert!(!engine.get_status().armed);
        assert!(!notif_ctrl.is_started());

        let writes = pref_store.write_calls();
        assert_eq!(writes, vec![true, false]);

        let events = emitted.lock().unwrap();
        let last_event = events.last().expect("must have emitted event");
        assert!(!last_event.armed);
        assert_eq!(last_event.battery_level, Some(9));
    }

    #[test]
    fn test_repeated_callbacks_only_sleeps_once() {
        let (engine, power_provider, sleep_req, _, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 50,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 8,
        })));

        notif_ctrl.trigger_callback();
        notif_ctrl.trigger_callback();
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 1);
    }

    #[test]
    fn test_disabled_then_rearm() {
        let (engine, _, _, pref_store, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 80,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");
        assert!(engine.get_status().armed);
        assert!(notif_ctrl.is_started());

        engine.set_armed(false).expect("disarm should succeed");
        assert!(!engine.get_status().armed);
        assert!(!notif_ctrl.is_started());

        engine.set_armed(true).expect("re-arm should succeed");
        assert!(engine.get_status().armed);
        assert!(notif_ctrl.is_started());

        let writes = pref_store.write_calls();
        assert_eq!(writes, vec![true, false, true]);
    }

    #[test]
    fn test_persistence_failure_prevents_sleep() {
        let (engine, power_provider, sleep_req, pref_store, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 50,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");
        *pref_store.write_fail_on_false.lock().unwrap() = true;

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 5,
        })));
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 0);
        let status = engine.get_status();
        assert!(status.error.is_some());
        assert!(status
            .error
            .unwrap()
            .contains("Persistence failure disarming sleep"));
    }

    #[test]
    fn test_sleep_failure_disarms_with_error() {
        let (engine, power_provider, sleep_req, _, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 50,
            },
            false,
        );

        *sleep_req.result.lock().unwrap() = Err("IOPMSleepSystem permission denied".to_string());
        engine.set_armed(true).expect("arm should succeed");

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 7,
        })));
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 1);
        let status = engine.get_status();
        assert!(!status.armed);
        assert!(status.error.is_some());
        assert!(status
            .error
            .unwrap()
            .contains("IOPMSleepSystem permission denied"));
    }

    #[test]
    fn test_already_low_on_arm_sleeps_immediately() {
        let (engine, _, sleep_req, _, _, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 8,
            },
            false,
        );

        let status = engine.set_armed(true).expect("arm should succeed");
        assert_eq!(sleep_req.sleep_calls(), 1);
        assert!(!status.armed);
    }

    #[test]
    fn test_off_works_when_power_query_fails() {
        let (engine, power_provider, _, pref_store, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 80,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");
        assert!(engine.get_status().armed);

        // Power query fails completely
        power_provider.set_status(Err("Hardware failure reading SMC".to_string()));

        // Turning OFF must still succeed! (Blocker 5)
        let status = engine.set_armed(false).expect("disarm must succeed");
        assert!(!status.armed);
        assert!(!notif_ctrl.is_started());
        assert_eq!(pref_store.read_armed().unwrap(), false);
    }

    #[test]
    fn test_handle_power_change_query_error_does_not_deadlock() {
        let (engine, power_provider, sleep_req, _, notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 80,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");

        // Simulate power query error during callback
        power_provider.set_status(Err("I/O error querying power sources".to_string()));

        // This must not deadlock! (Blocker 1)
        notif_ctrl.trigger_callback();

        assert_eq!(sleep_req.sleep_calls(), 0);
        let status = engine.get_status();
        assert!(status.error.is_some());
        assert!(status
            .error
            .unwrap()
            .contains("Failed to query power status"));
    }

    #[test]
    fn test_concurrent_callbacks_and_off_race_only_sleeps_at_most_once() {
        use std::thread;

        let (engine, power_provider, sleep_req, _, _notif_ctrl, _) = setup_test_engine(
            BatteryStatus {
                is_battery_powered: true,
                percentage: 50,
            },
            false,
        );

        engine.set_armed(true).expect("arm should succeed");

        power_provider.set_status(Ok(Some(BatteryStatus {
            is_battery_powered: true,
            percentage: 5,
        })));

        let mut handles = Vec::new();

        // Spawn multiple concurrent threads triggering power change
        for _ in 0..5 {
            let engine_clone = engine.clone();
            handles.push(thread::spawn(move || {
                engine_clone.handle_power_change();
            }));
        }

        // Spawn a thread attempting to turn OFF concurrently
        let engine_clone2 = engine.clone();
        handles.push(thread::spawn(move || {
            let _ = engine_clone2.set_armed(false);
        }));

        for h in handles {
            h.join().unwrap();
        }

        // Sleep must be called at most once (0 or 1), never more! (Blocker 2)
        assert!(sleep_req.sleep_calls() <= 1);
        assert!(!engine.get_status().armed);
    }
}
