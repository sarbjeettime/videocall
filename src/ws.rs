use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;
use log::{error, info};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::session::SessionManager;
use crate::state::{AppState, ClientMessage, ServerMessage};

/// WebSocket upgrade handler.
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    app_state: web::Data<AppState>,
    session_mgr: web::Data<SessionManager>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let session_id = Uuid::new_v4().to_string();
    info!("WebSocket connected: {}", session_id);

    // Create a channel for sending messages to this session
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
    session_mgr.register(&session_id, tx);

    let sid = session_id.clone();
    let state = app_state.clone();
    let mgr = session_mgr.clone();

    // Spawn a task to handle this WebSocket connection
    actix_web::rt::spawn(async move {
        // Track which room this session has joined
        let mut current_room: Option<String> = None;

        // Spawn a task to forward messages from the channel to the WebSocket
        let mut session_clone = session.clone();
        let forward_task = actix_web::rt::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if let Ok(json) = serde_json::to_string(&msg) {
                    if session_clone.text(json).await.is_err() {
                        break;
                    }
                }
            }
        });

        // Process incoming WebSocket messages
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let text_str = text.to_string();
                    match serde_json::from_str::<ClientMessage>(&text_str) {
                        Ok(client_msg) => {
                            handle_client_message(
                                &sid,
                                client_msg,
                                &state,
                                &mgr,
                                &mut current_room,
                            );
                        }
                        Err(e) => {
                            error!("Failed to parse message from {}: {}", sid, e);
                            mgr.send_to(
                                &sid,
                                &ServerMessage::Error {
                                    message: "Invalid message format".to_string(),
                                },
                            );
                        }
                    }
                }
                Message::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }
                Message::Close(_) => {
                    break;
                }
                _ => {}
            }
        }

        // Cleanup on disconnect
        info!("WebSocket disconnected: {}", sid);
        mgr.unregister(&sid);

        if let Some(room_code) = &current_room {
            let remaining = state.leave_room(room_code, &sid);
            mgr.send_to_many(&remaining, &ServerMessage::PartnerDisconnected);
        }

        forward_task.abort();
        let _ = session.close(None).await;
    });

    Ok(response)
}

/// Process a parsed client message.
fn handle_client_message(
    session_id: &str,
    msg: ClientMessage,
    state: &web::Data<AppState>,
    mgr: &web::Data<SessionManager>,
    current_room: &mut Option<String>,
) {
    match msg {
        ClientMessage::JoinRoom { room_code } => {
            if room_code.is_empty() {
                mgr.send_to(
                    session_id,
                    &ServerMessage::Error {
                        message: "Invalid room code".to_string(),
                    },
                );
                return;
            }

            let size = state.room_size(&room_code);
            if size >= 2 {
                mgr.send_to(session_id, &ServerMessage::RoomFull);
                return;
            }

            let new_size = state.join_room(&room_code, session_id);
            *current_room = Some(room_code.clone());

            mgr.send_to(
                session_id,
                &ServerMessage::RoomJoined {
                    room_code: room_code.clone(),
                },
            );

            if new_size == 2 {
                // Notify all members (including this session)
                let rooms = state.rooms.lock().unwrap();
                if let Some(members) = rooms.get(&room_code) {
                    let member_ids: Vec<String> = members.iter().cloned().collect();
                    drop(rooms); // Release lock before sending
                    mgr.send_to_many(&member_ids, &ServerMessage::PartnerConnected);
                }
            } else {
                mgr.send_to(session_id, &ServerMessage::WaitingForPartner);
            }
        }

        ClientMessage::ChatMessage { room_code, text } => {
            if room_code.is_empty() || text.is_empty() {
                return;
            }
            let others = state.get_others_in_room(&room_code, session_id);
            mgr.send_to_many(
                &others,
                &ServerMessage::ChatMessage {
                    text,
                    sender: "partner".to_string(),
                },
            );
        }

        ClientMessage::Offer { room_code, offer } => {
            let others = state.get_others_in_room(&room_code, session_id);
            mgr.send_to_many(&others, &ServerMessage::Offer { offer });
        }

        ClientMessage::Answer { room_code, answer } => {
            let others = state.get_others_in_room(&room_code, session_id);
            mgr.send_to_many(&others, &ServerMessage::Answer { answer });
        }

        ClientMessage::IceCandidate {
            room_code,
            candidate,
        } => {
            let others = state.get_others_in_room(&room_code, session_id);
            mgr.send_to_many(&others, &ServerMessage::IceCandidate { candidate });
        }
    }
}
