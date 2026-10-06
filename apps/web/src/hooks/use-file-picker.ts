'use client';

import { useEffect, useState, type RefObject } from 'react';
import { IOS_FILES_ACCEPT, isIOSFilePicker, LIBRARY_ACCEPT } from '@/lib/upload-accept';

/** Must be called directly by the tap handler: no await before input.click(). */
export function useFilePicker(input: RefObject<HTMLInputElement | null>) {
  const [ios, setIOS] = useState(false);
  useEffect(() => { setIOS(isIOSFilePicker()); }, []);
  const open = (source: 'files' | 'photos' = 'files') => {
    if (!input.current) return;
    input.current.accept = source === 'files' && isIOSFilePicker() ? IOS_FILES_ACCEPT : LIBRARY_ACCEPT;
    input.current.click();
  };
  return { ios, open };
}
