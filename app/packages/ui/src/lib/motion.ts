/** Calm, consistent motion tokens (150–250 ms, no springs bouncing around). */
export const EASE = [0.2, 0.8, 0.2, 1] as const;
export const fade = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease: EASE } };
export const list = { hidden: {}, show: { transition: { staggerChildren: 0.02 } } };
export const item = { hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } } };
