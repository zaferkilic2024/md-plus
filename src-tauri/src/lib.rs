mod pdf;
mod secrets;

use std::sync::Mutex;

/// Çift tıklanan dosyaların yolları (13 Ağu 2026).
///
/// Windows bir `.md`ye çift tıklayınca uygulamayı **argümanla** başlatır. İlk
/// açılışta bu argümanlar ön yüz daha ayağa kalkmadan gelir, o yüzden olayla
/// duyurulamaz — kimse dinlemiyorken bağırmak olurdu. Burada beklerler; arayüz
/// hazır olunca `startup_files` ile alır ve **bir kez** boşaltır.
#[derive(Default)]
struct StartupFiles(Mutex<Vec<String>>);

/// Bir argüman listesinden açılacak dosya yolları.
///
/// Tek kural: `-`/`--` ile başlayan her şey bayraktır, gerisi yoldur. İlk eleman
/// programın kendi yolu olduğu için hep atılır — yoksa uygulama her açılışta
/// kendini açmaya çalışırdı.
fn files_from(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .cloned()
        .collect()
}

#[tauri::command]
fn startup_files(state: tauri::State<'_, StartupFiles>) -> Vec<String> {
    // Alınan liste boşaltılır: yenilenen bir pencere aynı belgeleri ikinci kez
    // açmasın.
    std::mem::take(&mut *state.0.lock().unwrap())
}

pub fn run() {
    tauri::Builder::default()
        // TEK ÖRNEK, ve bu eklenti dosya ilişkilendirmesinin yarısıdır: onsuz
        // ikinci bir `.md`ye çift tıklamak ikinci bir SÜREÇ başlatır, iki süreç
        // aynı `session.json`'a yazar ve biri ötekinin sekmelerini siler.
        // Onunla, ikinci çağrı yaşayan pencereye bir olay olarak iner.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            let files = files_from(&argv);
            if let Some(window) = app.get_webview_window("main") {
                // Çift tıklayan kişi bir belge bekliyor: pencere öne gelmezse
                // belge açılır ve kimse görmez.
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if !files.is_empty() {
                let _ = app.emit("acilacak-belgeler", files);
            }
        }))
        .manage(StartupFiles::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            pdf::pdfe_bas,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            startup_files
        ])
        .setup(|app| {
            use tauri::Manager;
            let args: Vec<String> = std::env::args().collect();
            *app.state::<StartupFiles>().0.lock().unwrap() = files_from(&args);

            // DevTools artık açılışta kendiliğinden açılmıyor (Zafer, 17 Tem).
            // Hata ayıklaması gerektiğinde aşağıyı yorumdan çıkar — debug
            // derlemede pencere sağ tık → "Inspect" ile de açılır.
            // #[cfg(debug_assertions)]
            // {
            //     if let Some(window) = app.get_webview_window("main") {
            //         window.open_devtools();
            //     }
            // }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("MD Plus başlatılamadı");
}
