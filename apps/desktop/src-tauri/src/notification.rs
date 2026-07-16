use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
struct NotificationOperationGate {
    latest_revision: AtomicU64,
    lock: Mutex<()>,
}

#[derive(Clone, Default)]
pub struct PomodoroNotificationState {
    gate: Arc<NotificationOperationGate>,
}

impl PomodoroNotificationState {
    fn begin_operation(&self) -> (u64, Arc<NotificationOperationGate>) {
        let revision = self.gate.latest_revision.fetch_add(1, Ordering::SeqCst) + 1;
        (revision, Arc::clone(&self.gate))
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationPermissionState {
    NotDetermined,
    Denied,
    Authorized,
    Provisional,
    Ephemeral,
    Unsupported,
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ptr::NonNull,
        sync::mpsc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use block2::{DynBlock, RcBlock};
    use objc2::{
        define_class, extern_methods, rc::Retained, runtime::NSObject, runtime::ProtocolObject,
    };
    use objc2_foundation::{
        NSArray, NSCalendar, NSCalendarUnit, NSDate, NSError, NSObjectProtocol, NSString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNCalendarNotificationTrigger,
        UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };

    use super::NotificationPermissionState;

    const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);
    const PERMISSION_CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

    define_class!(
        #[unsafe(super(NSObject))]
        struct NotificationCenterDelegate;

        unsafe impl NSObjectProtocol for NotificationCenterDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for NotificationCenterDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present_notification(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                #[allow(deprecated)]
                completion_handler.call((UNNotificationPresentationOptions::Alert,));
            }
        }
    );

    impl NotificationCenterDelegate {
        extern_methods!(
            #[unsafe(method(new))]
            fn new() -> Retained<Self>;
        );
    }

    thread_local! {
        static NOTIFICATION_DELEGATE: Retained<NotificationCenterDelegate> = NotificationCenterDelegate::new();
    }

    pub fn initialize() {
        NOTIFICATION_DELEGATE.with(|delegate| {
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let delegate = ProtocolObject::from_ref(&**delegate);
            center.setDelegate(Some(delegate));
        });
    }

    pub fn permission_state() -> Result<NotificationPermissionState, String> {
        let settings = notification_settings()?;
        Ok(permission_state_from_status(settings.authorizationStatus()))
    }

    pub fn request_permission() -> Result<NotificationPermissionState, String> {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |_granted, error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                Err(ns_error_message(error))
            };
            let _ = sender.send(result);
        });

        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert,
            &completion,
        );
        receiver
            .recv_timeout(PERMISSION_CALLBACK_TIMEOUT)
            .map_err(|_| {
                "Timed out while waiting for macOS notification permission".to_string()
            })??;

        permission_state()
    }

    pub fn schedule(
        request_id: String,
        deadline_ms: u64,
        title: String,
        body: String,
    ) -> Result<(), String> {
        let request_id = validated_request_id(request_id)?;
        let settings = notification_settings()?;
        match permission_state_from_status(settings.authorizationStatus()) {
            NotificationPermissionState::Authorized
            | NotificationPermissionState::Provisional
            | NotificationPermissionState::Ephemeral => {}
            NotificationPermissionState::NotDetermined => {
                return Err(
                    "macOS notification permission has not been requested; request it from an explicit user action first"
                        .to_string(),
                )
            }
            NotificationPermissionState::Denied => {
                return Err("macOS notification permission is denied".to_string())
            }
            NotificationPermissionState::Unsupported => {
                return Err("Native notifications are unavailable on this platform".to_string())
            }
        }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("System clock is before the Unix epoch: {error}"))?
            .as_millis();
        let deadline_ms = u128::from(deadline_ms);
        if deadline_ms <= now_ms {
            return Err("Pomodoro notification deadline must be in the future".to_string());
        }
        let deadline_seconds = deadline_ms as f64 / 1_000.0;

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));

        let deadline = NSDate::dateWithTimeIntervalSince1970(deadline_seconds);
        let calendar = NSCalendar::currentCalendar();
        let components = calendar.components_fromDate(
            NSCalendarUnit::Year
                | NSCalendarUnit::Month
                | NSCalendarUnit::Day
                | NSCalendarUnit::Hour
                | NSCalendarUnit::Minute
                | NSCalendarUnit::Second,
            &deadline,
        );
        let trigger = UNCalendarNotificationTrigger::triggerWithDateMatchingComponents_repeats(
            &components,
            false,
        );
        let identifier = NSString::from_str(&request_id);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            Some(&trigger),
        );

        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                Err(ns_error_message(error))
            };
            let _ = sender.send(result);
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));

        receiver
            .recv_timeout(CALLBACK_TIMEOUT)
            .map_err(|_| "Timed out while scheduling the macOS notification".to_string())?
    }

    pub fn cancel(request_id: String) -> Result<(), String> {
        let request_id = validated_request_id(request_id)?;
        let identifiers = NSArray::from_retained_slice(&[NSString::from_str(&request_id)]);
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
        center.removeDeliveredNotificationsWithIdentifiers(&identifiers);
        Ok(())
    }

    fn notification_settings() -> Result<Retained<UNNotificationSettings>, String> {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications supplies a valid settings object for the duration of the
            // callback. Retaining it gives the receiving command independent ownership.
            let settings = unsafe { Retained::retain(settings.as_ptr()) }
                .expect("a non-null UserNotifications settings pointer must retain");
            let _ = sender.send(settings);
        });
        center.getNotificationSettingsWithCompletionHandler(&completion);
        receiver
            .recv_timeout(CALLBACK_TIMEOUT)
            .map_err(|_| "Timed out while reading macOS notification settings".to_string())
    }

    fn permission_state_from_status(status: UNAuthorizationStatus) -> NotificationPermissionState {
        if status == UNAuthorizationStatus::NotDetermined {
            NotificationPermissionState::NotDetermined
        } else if status == UNAuthorizationStatus::Denied {
            NotificationPermissionState::Denied
        } else if status == UNAuthorizationStatus::Authorized {
            NotificationPermissionState::Authorized
        } else if status == UNAuthorizationStatus::Provisional {
            NotificationPermissionState::Provisional
        } else if status == UNAuthorizationStatus::Ephemeral {
            NotificationPermissionState::Ephemeral
        } else {
            NotificationPermissionState::Unsupported
        }
    }

    fn validated_request_id(request_id: String) -> Result<String, String> {
        let request_id = request_id.trim();
        if request_id.is_empty() {
            Err("Notification request id must not be empty".to_string())
        } else {
            Ok(request_id.to_string())
        }
    }

    fn ns_error_message(error: *mut NSError) -> String {
        // SAFETY: Apple passes either null or a valid NSError for the duration of the callback.
        unsafe { &*error }.localizedDescription().to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::NotificationPermissionState;

    pub fn initialize() {}

    pub fn permission_state() -> Result<NotificationPermissionState, String> {
        Ok(NotificationPermissionState::Unsupported)
    }

    pub fn request_permission() -> Result<NotificationPermissionState, String> {
        Err("Native macOS notifications are unavailable on this platform".to_string())
    }

    pub fn schedule(
        _request_id: String,
        _deadline_ms: u64,
        _title: String,
        _body: String,
    ) -> Result<(), String> {
        Err("Native macOS notifications are unavailable on this platform".to_string())
    }

    pub fn cancel(_request_id: String) -> Result<(), String> {
        Err("Native macOS notifications are unavailable on this platform".to_string())
    }
}

pub fn initialize() {
    platform::initialize();
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Native notification task failed: {error}"))?
}

#[tauri::command]
pub async fn notification_permission_state() -> Result<NotificationPermissionState, String> {
    run_blocking(platform::permission_state).await
}

#[tauri::command]
pub async fn request_notification_permission() -> Result<NotificationPermissionState, String> {
    run_blocking(platform::request_permission).await
}

#[tauri::command]
pub async fn schedule_pomodoro_notification(
    state: tauri::State<'_, PomodoroNotificationState>,
    request_id: String,
    deadline_ms: u64,
    title: String,
    body: String,
) -> Result<(), String> {
    let (revision, gate) = state.begin_operation();
    run_blocking(move || {
        let _guard = gate
            .lock
            .lock()
            .map_err(|_| "Pomodoro notification operation lock is poisoned".to_string())?;
        if gate.latest_revision.load(Ordering::SeqCst) != revision {
            return Ok(());
        }
        platform::schedule(request_id, deadline_ms, title, body)
    })
    .await
}

#[tauri::command]
pub async fn cancel_pomodoro_notification(
    state: tauri::State<'_, PomodoroNotificationState>,
    request_id: String,
) -> Result<(), String> {
    let (revision, gate) = state.begin_operation();
    run_blocking(move || {
        let _guard = gate
            .lock
            .lock()
            .map_err(|_| "Pomodoro notification operation lock is poisoned".to_string())?;
        if gate.latest_revision.load(Ordering::SeqCst) != revision {
            return Ok(());
        }
        platform::cancel(request_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_native_operation_invalidates_older_renderer_work() {
        let state = PomodoroNotificationState::default();
        let (older_revision, older_gate) = state.begin_operation();
        let (newer_revision, newer_gate) = state.begin_operation();

        assert_eq!(older_revision + 1, newer_revision);
        assert_ne!(
            older_gate.latest_revision.load(Ordering::SeqCst),
            older_revision
        );
        assert_eq!(
            newer_gate.latest_revision.load(Ordering::SeqCst),
            newer_revision
        );
    }
}
