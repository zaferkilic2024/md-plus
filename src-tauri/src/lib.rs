mod pdf;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![pdf::pdfe_bas])
        .setup(|_app| {
            // DevTools artık açılışta kendiliğinden açılmıyor (Zafer, 17 Tem).
            // Hata ayıklaması gerektiğinde aşağıyı yorumdan çıkar — debug
            // derlemede pencere sağ tık → "Inspect" ile de açılır.
            // #[cfg(debug_assertions)]
            // {
            //     use tauri::Manager;
            //     if let Some(window) = _app.get_webview_window("main") {
            //         window.open_devtools();
            //     }
            // }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("MD Plus başlatılamadı");
}
