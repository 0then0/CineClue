import { type MouseEvent, type PointerEvent, useRef } from "react";

function outside(dialog: HTMLDialogElement, event: { clientX: number; clientY: number }) {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

export function useBackdropClose() {
  const startedOutside = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      startedOutside.current =
        event.target === event.currentTarget && outside(event.currentTarget, event);
    },
    onPointerCancel() {
      startedOutside.current = false;
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const close =
        startedOutside.current &&
        event.target === event.currentTarget &&
        outside(event.currentTarget, event);
      startedOutside.current = false;
      if (close) event.currentTarget.close();
    },
  };
}
