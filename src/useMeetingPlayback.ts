import { useEffect, useRef, useState } from 'react';
import { meetingMedia, type Meeting } from './meetings';
import { desktop } from './storage';

export function useMeetingPlayback(meeting:Meeting | null) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState({id:'',time:0,duration:0,playing:false,available:false,error:''});
  useEffect(() => {
    let live = true;
    const element = new Audio();
    audio.current = element;
    setState({id:meeting?.id || '',time:0,duration:meeting?.duration || 0,playing:false,available:false,error:''});
    const update = () => { if (live) setState(value => ({...value,time:element.currentTime,duration:Number.isFinite(element.duration) ? element.duration : value.duration,playing:!element.paused && !element.ended})); };
    const failed = () => { if (live) setState(value => ({...value,playing:false,error:'The recording could not be played.'})); };
    for (const event of ['timeupdate','loadedmetadata','play','pause','ended','seeked']) element.addEventListener(event,update);
    element.addEventListener('error',failed);
    if (meeting?.media && desktop && !meeting.deletedAt) void meetingMedia(meeting.id).then(source => {
      if (live) { element.src = source; element.preload = 'metadata'; setState(value => ({...value,available:true})); }
    }).catch(() => { if (live) setState(value => ({...value,error:'The recording is missing. Restore a saved copy in Settings.'})); });
    return () => { live = false; element.pause(); element.removeAttribute('src'); element.load(); if (audio.current === element) audio.current = null; };
  }, [meeting?.id,meeting?.media,meeting?.deletedAt]);
  function seek(time:number, play = false) {
    if (!state.available || !audio.current) return;
    audio.current.currentTime = Math.max(0,Math.min(state.duration,time));
    setState(value => ({...value,time:audio.current!.currentTime,error:''}));
    if (play) void audio.current.play().catch(() => setState(value => ({...value,playing:false,error:'Press Play to listen to the recording.'})));
  }
  function toggle() {
    if (!state.available || !audio.current) return;
    if (audio.current.paused) void audio.current.play().catch(() => setState(value => ({...value,error:'The recording could not be played.'})));
    else audio.current.pause();
  }
  return {...state,seek,toggle};
}
export type MeetingPlayback = ReturnType<typeof useMeetingPlayback>;
