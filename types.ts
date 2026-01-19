
export interface TranscriptItem {
  id: string;
  sender: 'user' | 'sadhan';
  text: string;
  timestamp: Date;
}

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}
