mod session;
mod state;
mod ws;

use actix_files as fs;
use actix_web::{web, App, HttpServer};
use log::info;

use session::SessionManager;
use state::AppState;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let app_state = web::Data::new(AppState::new());
    let session_mgr = web::Data::new(SessionManager::new());

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .expect("PORT must be a valid number");

    info!("Server running on http://localhost:{}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .app_data(session_mgr.clone())
            // WebSocket endpoint
            .route("/ws", web::get().to(ws::ws_handler))
            // Serve static files from public/ directory
            .service(fs::Files::new("/", "./public").index_file("index.html"))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}


