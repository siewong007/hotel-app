use axum::extract::ws::{Message, WebSocket};
use chrono::NaiveDate;
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub struct AvailabilityEvent {
    pub event_id: String,
    pub event_type: &'static str,
    pub room_type_id: i64,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub remaining_rooms: i64,
}

#[derive(Debug, Clone)]
pub struct AvailabilityHub {
    sender: broadcast::Sender<AvailabilityEvent>,
}

impl Default for AvailabilityHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }
}

impl AvailabilityHub {
    pub fn subscribe(&self) -> broadcast::Receiver<AvailabilityEvent> {
        self.sender.subscribe()
    }

    pub fn publish(&self, event: AvailabilityEvent) {
        let _ = self.sender.send(event);
    }
}

pub async fn serve_socket(mut socket: WebSocket, hub: AvailabilityHub) {
    let mut events = hub.subscribe();
    loop {
        tokio::select! {
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        let Ok(payload) = serde_json::to_string(&event) else {
                            continue;
                        };
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Ping(payload)))
                        if socket.send(Message::Pong(payload.clone())).await.is_err() => break,
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}
