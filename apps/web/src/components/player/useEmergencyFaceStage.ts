'use client';
import { useEffect, useState } from 'react';
import { chooseEmergencyStage, type EmergencyStage } from '@/app/player/emergencyStage';

/** Read only this face's viewport; native w/h stay deliberately absent on Presentations. */
export function readEmergencyFaceStage(): EmergencyStage | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const face = Number(new URLSearchParams(window.location.search).get('face'));
  if (!Number.isInteger(face) || face < 1 || document.documentElement.getAttribute('data-led-cfg') === '1') return null;
  const stage = chooseEmergencyStage({ width: window.innerWidth, height: window.innerHeight }, {
    rotated: document.body.style.transform.includes('rotate(90deg)'),
  });
  return stage.width > 0 && stage.height > 0 ? stage : null;
}

/** Secondary Presentations rotate their own body; viewport units keep the old axes. */
export function useEmergencyFaceStage(): EmergencyStage | null {
  const [stage, setStage] = useState<EmergencyStage | null>(null);
  useEffect(() => {
    const face = Number(new URLSearchParams(window.location.search).get('face'));
    if (!Number.isInteger(face) || face < 1) return; // Preserve every primary/single-sided path.
    const measure = () => {
      const next = readEmergencyFaceStage();
      if (!next) { setStage(null); return; }
      setStage(previous => previous?.width === next.width && previous?.height === next.height ? previous : next);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-led-cfg'] });
    return () => { window.removeEventListener('resize', measure); observer.disconnect(); };
  }, []);
  return stage;
}
