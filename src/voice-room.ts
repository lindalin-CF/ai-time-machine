// Voice rooms: each browser tab talks to its own PortalVoiceAgent instance, named by a random
// UUID that public/voice.js keeps in sessionStorage. One Durable Object per room name means one
// message table per tab, so visitors never share history or model context.

/** How long a room keeps its messages after the last one: 24 hours. */
export const VOICE_RETENTION_MS = 24 * 60 * 60 * 1000;

const ROOM_PATH = /^\/agents\/portal-voice-agent\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * True for a voice agent URL whose room is a random (v4) UUID. Anything else, including the
 * old shared "default" room, is refused before it reaches a Durable Object.
 */
export function isVoiceRoomPath(pathname: string): boolean {
  return ROOM_PATH.test(pathname);
}
