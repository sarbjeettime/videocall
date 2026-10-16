use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::mpsc;

use crate::state::ServerMessage;

/// Manages active WebSocket sessions and enables broadcasting to rooms.
pub struct SessionManager {
    /// Maps session ID -> message sender channel.
    sessions: Mutex<HashMap<String, mpsc::UnboundedSender<ServerMessage>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Register a new session with its message channel.
    pub fn register(&self, session_id: &str, tx: mpsc::UnboundedSender<ServerMessage>) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(session_id.to_string(), tx);
    }

    /// Unregister a session.
    pub fn unregister(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(session_id);
    }

    /// Send a message to a specific session.
    pub fn send_to(&self, session_id: &str, msg: &ServerMessage) {
        let sessions = self.sessions.lock().unwrap();
        if let Some(tx) = sessions.get(session_id) {
            let _ = tx.send(msg.clone());
        }
    }

    /// Send a message to all given session IDs.
    pub fn send_to_many(&self, session_ids: &[String], msg: &ServerMessage) {
        let sessions = self.sessions.lock().unwrap();
        for id in session_ids {
            if let Some(tx) = sessions.get(id) {
                let _ = tx.send(msg.clone());
            }
        }
    }
}
