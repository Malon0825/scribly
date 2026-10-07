import { Pause, Play } from '@phosphor-icons/react';
import { meetingTime } from './meetings';
import type { MeetingPlayback } from './useMeetingPlayback';

export function MeetingPlayer({player}:{player:MeetingPlayback}) {
  return <div className="meeting-player" aria-label="Meeting recording">
    <button className="icon-button" aria-label={player.playing ? 'Pause recording' : 'Play recording'} disabled={!player.available} onClick={player.toggle}>{player.playing ? <Pause size={20} /> : <Play size={20} />}</button>
    <input aria-label="Recording position" type="range" min={0} max={player.duration || 1} step={0.1} value={Math.min(player.time,player.duration)} disabled={!player.available} onChange={event => player.seek(Number(event.target.value))} />
    <span>{meetingTime(player.time)} / {meetingTime(player.duration)}</span>
    {player.error && <p role="alert">{player.error}</p>}
  </div>;
}
