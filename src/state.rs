use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Shared application state for room management.
pub struct AppState {
    /// Maps room codes to the set of session IDs currently in that room.
    pub rooms: Mutex<HashMap<String, HashSet<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            rooms: Mutex::new(HashMap::new()),
        }
    }

    /// Returns the number of participants in a room.
    pub fn room_size(&self, room_code: &str) -> usize {
        let rooms = self.rooms.lock().unwrap();
        rooms.get(room_code).map_or(0, |s| s.len())
    }

    /// Adds a session to a room. Returns the new size.
    pub fn join_room(&self, room_code: &str, session_id: &str) -> usize {
        let mut rooms = self.rooms.lock().unwrap();
        let room = rooms
            .entry(room_code.to_string())
            .or_insert_with(HashSet::new);
        room.insert(session_id.to_string());
        room.len()
    }

    /// Removes a session from a room. Returns remaining participants.
    pub fn leave_room(&self, room_code: &str, session_id: &str) -> Vec<String> {
        let mut rooms = self.rooms.lock().unwrap();
        let remaining = if let Some(room) = rooms.get_mut(room_code) {
            room.remove(session_id);
            let remaining: Vec<String> = room.iter().cloned().collect();
            if room.is_empty() {
                rooms.remove(room_code);
            }
            remaining
        } else {
            Vec::new()
        };
        remaining
    }

    /// Gets all session IDs in a room (excluding the given session).
    pub fn get_others_in_room(&self, room_code: &str, exclude_id: &str) -> Vec<String> {
        let rooms = self.rooms.lock().unwrap();
        rooms
            .get(room_code)
            .map(|room| {
                room.iter()
                    .filter(|id| id.as_str() != exclude_id)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
}

// --- Message types for client <-> server communication ---

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "join_room")]
    JoinRoom { room_code: String },

    #[serde(rename = "chat_message")]
    ChatMessage { room_code: String, text: String },

    #[serde(rename = "offer")]
    Offer {
        room_code: String,
        offer: serde_json::Value,
    },

    #[serde(rename = "answer")]
    Answer {
        room_code: String,
        answer: serde_json::Value,
    },

    #[serde(rename = "ice_candidate")]
    IceCandidate {
        room_code: String,
        candidate: serde_json::Value,
    },
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "room_joined")]
    RoomJoined { room_code: String },

    #[serde(rename = "room_full")]
    RoomFull,

    #[serde(rename = "waiting_for_partner")]
    WaitingForPartner,

    #[serde(rename = "partner_connected")]
    PartnerConnected,

    #[serde(rename = "partner_disconnected")]
    PartnerDisconnected,

    #[serde(rename = "chat_message")]
    ChatMessage { text: String, sender: String },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "offer")]
    Offer { offer: serde_json::Value },

    #[serde(rename = "answer")]
    Answer { answer: serde_json::Value },

    #[serde(rename = "ice_candidate")]
    IceCandidate { candidate: serde_json::Value },
}
