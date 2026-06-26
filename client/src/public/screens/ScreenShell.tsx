// Shared screen container + transition + focus management (§17.7 / §17.8).
//
// Transitions: a CSS fade/slide-in on mount. The animation is defined purely in
// CSS (Tailwind arbitrary keyframes below via inline <style>-free classes) and
// the global `prefers-reduced-motion` rule in index.css already collapses all
// transition/animation durations to ~0ms, so motion is automatically respected.
//
// Focus: on mount we move focus to the screen heading (tabindex=-1 + .focus())
// so screen-reader and keyboard users land on the new screen.
import { useEffect, useRef, type ReactNode } from 'react';

interface ScreenShellProps {
  heading: string;
  /** screen key — changing it re-runs the mount animation + refocus */
  screenKey: string;
  children: ReactNode;
  /** optional node rendered above the heading (e.g. logo) */
  beforeHeading?: ReactNode;
  /** visually-hidden heading when a custom header is shown above */
  headingClassName?: string;
}

export function ScreenShell({
  heading,
  screenKey,
  children,
  beforeHeading,
  headingClassName = 'text-2xl font-bold text-brand-text',
}: ScreenShellProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Defer to next frame so the element is in the DOM and animation has begun.
    const id = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [screenKey]);

  return (
    <div
      key={screenKey}
      className="public-screen-in mx-auto w-full max-w-md px-5 py-8"
    >
      {beforeHeading}
      <h1 ref={headingRef} tabIndex={-1} className={`${headingClassName} outline-none`}>
        {heading}
      </h1>
      {children}
    </div>
  );
}
