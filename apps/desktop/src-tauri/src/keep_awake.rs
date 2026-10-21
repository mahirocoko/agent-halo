use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssertionTransition {
    Acquire,
    Release,
    None,
}

fn assertion_transition(is_active: bool, requested_active: bool) -> AssertionTransition {
    match (is_active, requested_active) {
        (false, true) => AssertionTransition::Acquire,
        (true, false) => AssertionTransition::Release,
        _ => AssertionTransition::None,
    }
}

#[derive(Clone, Copy)]
enum AssertionKind {
    Display,
    System,
}

impl AssertionKind {
    fn assertion_type(self) -> &'static str {
        match self {
            Self::Display => "PreventUserIdleDisplaySleep",
            Self::System => "PreventUserIdleSystemSleep",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Display => "Agent Halo — Keep display awake",
            Self::System => "Agent Halo — Keep system awake",
        }
    }
}

#[derive(Default)]
pub struct KeepAwakeState {
    display: AssertionState,
    system: AssertionState,
}

impl KeepAwakeState {
    pub fn set_active(&self, active: bool) -> Result<bool, String> {
        self.display.set_active(AssertionKind::Display, active)
    }

    pub fn set_system_active(&self, active: bool) -> Result<bool, String> {
        self.system.set_active(AssertionKind::System, active)
    }

    pub fn release_all(&self) {
        // Always attempt both, even if one release fails.
        let _ = self.set_active(false);
        let _ = self.set_system_active(false);
    }
}

#[derive(Default)]
struct AssertionState {
    assertion_id: Mutex<Option<u32>>,
}

impl AssertionState {
    fn set_active(&self, kind: AssertionKind, requested_active: bool) -> Result<bool, String> {
        let mut assertion_id = self
            .assertion_id
            .lock()
            .map_err(|_| "Keep-awake state lock failed".to_string())?;

        match assertion_transition(assertion_id.is_some(), requested_active) {
            AssertionTransition::Acquire => {
                *assertion_id = Some(platform::acquire(kind)?);
            }
            AssertionTransition::Release => {
                if let Some(id) = *assertion_id {
                    platform::release(id)?;
                    *assertion_id = None;
                }
            }
            AssertionTransition::None => {}
        }

        Ok(assertion_id.is_some())
    }
}

impl Drop for AssertionState {
    fn drop(&mut self) {
        let Ok(assertion_id) = self.assertion_id.get_mut() else {
            return;
        };
        if let Some(id) = assertion_id.take() {
            let _ = platform::release(id);
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::{base::TCFType, string::CFString};

    type IOPMAssertionID = u32;
    type IOPMAssertionLevel = u32;
    type IOReturn = i32;

    const ASSERTION_LEVEL_ON: IOPMAssertionLevel = 255;
    const IO_RETURN_SUCCESS: IOReturn = 0;

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: core_foundation::string::CFStringRef,
            assertion_level: IOPMAssertionLevel,
            assertion_name: core_foundation::string::CFStringRef,
            assertion_id: *mut IOPMAssertionID,
        ) -> IOReturn;
        fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
    }

    pub fn acquire(kind: super::AssertionKind) -> Result<IOPMAssertionID, String> {
        let assertion_type = CFString::new(kind.assertion_type());
        let assertion_name = CFString::new(kind.name());
        let mut assertion_id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type.as_concrete_TypeRef(),
                ASSERTION_LEVEL_ON,
                assertion_name.as_concrete_TypeRef(),
                &mut assertion_id,
            )
        };

        if result == IO_RETURN_SUCCESS {
            Ok(assertion_id)
        } else {
            Err(format!(
                "Failed to acquire {} keep-awake assertion ({result})",
                kind.assertion_type()
            ))
        }
    }

    pub fn release(assertion_id: IOPMAssertionID) -> Result<(), String> {
        let result = unsafe { IOPMAssertionRelease(assertion_id) };
        if result == IO_RETURN_SUCCESS {
            Ok(())
        } else {
            Err(format!("Failed to release keep-awake assertion ({result})"))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn acquire(_kind: super::AssertionKind) -> Result<u32, String> {
        Err("Keep awake is available only on macOS".to_string())
    }

    pub fn release(_assertion_id: u32) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{assertion_transition, AssertionTransition, KeepAwakeState};

    #[test]
    fn acquires_only_when_inactive_becomes_requested() {
        assert_eq!(
            assertion_transition(false, true),
            AssertionTransition::Acquire
        );
        assert_eq!(assertion_transition(true, true), AssertionTransition::None);
    }

    #[test]
    fn releases_only_when_active_is_no_longer_requested() {
        assert_eq!(
            assertion_transition(true, false),
            AssertionTransition::Release
        );
        assert_eq!(
            assertion_transition(false, false),
            AssertionTransition::None
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_assertions_are_independent_idempotent_and_release_together() {
        let state = KeepAwakeState::default();
        assert_eq!(state.set_active(true), Ok(true));
        assert_eq!(state.set_system_active(true), Ok(true));
        let display_id = *state.display.assertion_id.lock().unwrap();
        let system_id = *state.system.assertion_id.lock().unwrap();
        assert_ne!(display_id, system_id);
        assert_eq!(state.set_system_active(true), Ok(true));
        assert_eq!(*state.system.assertion_id.lock().unwrap(), system_id);
        assert_eq!(state.set_active(false), Ok(false));
        assert_eq!(*state.system.assertion_id.lock().unwrap(), system_id);
        assert_eq!(state.set_active(true), Ok(true));
        assert_eq!(state.set_system_active(false), Ok(false));
        assert!(state.display.assertion_id.lock().unwrap().is_some());
        assert_eq!(state.set_system_active(true), Ok(true));
        state.release_all();
        assert!(state.display.assertion_id.lock().unwrap().is_none());
        assert!(state.system.assertion_id.lock().unwrap().is_none());
        state.release_all();
    }

    #[test]
    fn assertion_types_only_block_user_idle_sleep() {
        assert_eq!(
            super::AssertionKind::Display.assertion_type(),
            "PreventUserIdleDisplaySleep"
        );
        assert_eq!(
            super::AssertionKind::System.assertion_type(),
            "PreventUserIdleSystemSleep"
        );
    }
}
