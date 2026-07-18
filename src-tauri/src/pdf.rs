// Printing straight to a PDF file (UC-11).
//
// The WebView renders the page, so the PDF is exactly what the writer saw — same
// typesetting, same formulas, same images. Tauri's own print() only opens the
// system dialog and makes you pick "Microsoft Print to PDF", so we call the
// WebView's PrintToPdf ourselves.

#[cfg(windows)]
pub fn print_to_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    use std::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let (sender, receiver) = mpsc::channel::<Result<(), String>>();

    window
        .with_webview(move |webview| {
            let done = sender.clone();

            // The work is wrapped so `?` has somewhere to go: with_webview hands
            // us a closure that returns nothing.
            let started = (|| -> Result<(), String> {
                // SAFETY: the controller outlives the window, and this runs on
                // the UI thread that owns it.
                unsafe {
                    let core = webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| error.to_string())?;

                    // PrintToPdf arrived in ICoreWebView2_7; on an older runtime
                    // this fails and the caller is told, rather than hanging.
                    let printer: ICoreWebView2_7 = core.cast().map_err(|_| {
                        "WebView2 sürümü PDF üretimini desteklemiyor".to_string()
                    })?;

                    let finished = done.clone();
                    printer
                        .PrintToPdf(
                            &HSTRING::from(path.as_str()),
                            None, // default settings; the sheet's @page rules apply
                            &PrintToPdfCompletedHandler::create(Box::new(
                                move |code, ok| {
                                    let outcome = match (code, ok) {
                                        (Ok(()), true) => Ok(()),
                                        (Ok(()), false) => {
                                            Err("PDF yazılamadı".to_string())
                                        }
                                        (Err(error), _) => Err(error.to_string()),
                                    };
                                    let _ = finished.send(outcome);
                                    Ok(())
                                },
                            )),
                        )
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            })();

            // If it never started, nothing will ever complete: say so now, or the
            // caller waits out the full timeout for a message that cannot come.
            if let Err(error) = started {
                let _ = sender.send(Err(error));
            }
        })
        .map_err(|error| error.to_string())?;

    // PrintToPdf is asynchronous; wait for the handler rather than returning
    // before the file exists.
    receiver
        .recv_timeout(std::time::Duration::from_secs(60))
        .map_err(|_| "PDF üretimi zaman aşımına uğradı".to_string())?
}

#[cfg(not(windows))]
pub fn print_to_pdf(_window: tauri::WebviewWindow, _path: String) -> Result<(), String> {
    Err("PDF üretimi yalnız Windows'ta destekleniyor".into())
}

#[tauri::command]
pub async fn pdfe_bas(window: tauri::WebviewWindow, yol: String) -> Result<(), String> {
    print_to_pdf(window, yol)
}
