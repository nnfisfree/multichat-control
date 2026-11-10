//! The app draws its window with Microsoft Edge WebView2, which is part of Windows 10 and 11.
//! On the rare PC without it, the app says so plainly and offers Microsoft's free installer,
//! instead of failing to start without a word.

/// Microsoft's direct download of the WebView2 installer (the "Evergreen Bootstrapper").
const INSTALLER: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
/// WebView2's product id in the registry, as Microsoft documents for this check.
const CLIENT: &str = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

#[cfg(windows)]
mod win {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_YESNO};

    pub fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The installed version under one registry key, if any.
    pub fn version(root: HKEY, key: &str) -> Option<String> {
        let (key, value) = (wide(key), wide("pv"));
        let mut buf = [0u16; 64];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let status = unsafe { RegGetValueW(root, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        if status != 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    pub fn roots() -> [(HKEY, &'static str); 3] {
        [(HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\"), (HKEY_LOCAL_MACHINE, r"SOFTWARE\"), (HKEY_CURRENT_USER, r"Software\")]
    }

    pub fn ask(title: &str, text: &str) -> bool {
        let (t, m) = (wide(title), wide(text));
        unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_YESNO | MB_ICONWARNING) == IDYES }
    }

    pub fn tell(title: &str, text: &str) {
        let (t, m) = (wide(title), wide(text));
        unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_OK | MB_ICONERROR) };
    }

    pub fn open(url: &str) {
        let (verb, target) = (wide("open"), wide(url));
        unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    }
}

const TITLE: &str = "NoName's Multichat Control";

/// True when WebView2 is installed. Development builds can pretend it isn't, to test the message.
#[cfg(windows)]
fn installed() -> bool {
    if cfg!(debug_assertions) && std::env::var_os("NNF_PRETEND_NO_WEBVIEW2").is_some() {
        return false;
    }
    win::roots().iter().any(|(root, prefix)| {
        win::version(*root, &format!("{prefix}{CLIENT}")).is_some_and(|v| !v.is_empty() && v != "0.0.0.0")
    })
}

/// Checks for WebView2 before anything else starts. Returns false when the app can't run.
pub fn ensure() -> bool {
    #[cfg(windows)]
    if !installed() {
        crate::storage::log("app", "WebView2 is missing; offered Microsoft's installer");
        let text = "This app needs Microsoft Edge WebView2 to show its window. It comes with Windows 10 and 11, \
but it's missing on this PC.\n\nIt's free and made by Microsoft. Download the installer now?\n\n\
After installing it, start the app again.";
        if win::ask(TITLE, text) {
            win::open(INSTALLER);
        }
        return false;
    }
    true
}

/// The window couldn't start for another reason: say so instead of closing silently.
pub fn failed(error: &str) {
    crate::storage::log("app", &format!("could not start: {error}"));
    #[cfg(windows)]
    win::tell(TITLE, &format!("The app couldn't start.\n\n{error}\n\nIf this keeps happening, reinstalling Microsoft Edge WebView2 usually fixes it:\n{INSTALLER}"));
}
