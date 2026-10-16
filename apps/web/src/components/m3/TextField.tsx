import { motion } from "motion/react";
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { motionScheme } from "../../theme/motion";
import { Icon } from "./Icon";

/*
 * M3 outlined text field (tokens: 56dp, extra-small corners, 1dp `outline` → 2dp `primary`
 * when focused). The label floats into a notch in the outline; the notch is a <legend>, so it
 * works on any background. The label moves on the Expressive spring.
 */

type FrameProps = {
  id: string;
  label: string;
  floated: boolean;
  focused: boolean;
  leadingIcon?: string;
  trailing?: ReactNode;
  supporting?: ReactNode;
  multiline?: boolean;
  className?: string;
  children: ReactNode;
};

function Frame({ id, label, floated, focused, leadingIcon, trailing, supporting, multiline, className = "", children }: FrameProps) {
  // Resting label sits after the leading icon (12 + 24 + 16 = 52px), floated it aligns to 16px.
  const restX = leadingIcon ? 52 : 16;
  return (
    <div className={className}>
      <div className={`group relative flex ${multiline ? "items-start" : "items-center"} rounded-xs text-on-surface`}>
        {leadingIcon && (
          <Icon name={leadingIcon} className={`ml-3 shrink-0 ${multiline ? "mt-4" : ""} ${focused ? "text-primary" : "text-on-surface-variant"}`} />
        )}
        <div className="relative min-w-0 flex-1">{children}</div>
        {trailing}
        {/* Outline with notch */}
        <fieldset
          aria-hidden
          className={`pointer-events-none absolute inset-0 -top-2 m-0 rounded-xs px-3 transition-colors duration-150 ${
            focused ? "border-2 border-primary" : "border border-outline group-hover:border-on-surface"
          }`}
        >
          <legend
            className="type-body-small invisible h-4 whitespace-nowrap transition-[max-width] duration-100"
            style={{ maxWidth: floated ? "100%" : 0.01 }}
          >
            <span className="px-1">{label}</span>
          </legend>
        </fieldset>
        <motion.label
          htmlFor={id}
          className={`type-body-large pointer-events-none absolute left-0 origin-left whitespace-nowrap ${
            focused ? "text-primary" : "text-on-surface-variant"
          }`}
          style={{ top: multiline ? 16 : "50%" }}
          initial={false}
          // Label box is 24px tall: at rest it's vertically centered; floated (scaled to body-small)
          // its center sits exactly on the top outline, aligned with the notch at 16px.
          animate={
            floated
              ? { x: 16, y: multiline ? -28 : -40, scale: 0.75 }
              : { x: restX, y: multiline ? 0 : -12, scale: 1 }
          }
          transition={motionScheme.fastSpatial}
        >
          {label}
        </motion.label>
      </div>
      {supporting && <div className="type-body-small px-4 pt-1 text-on-surface-variant">{supporting}</div>}
    </div>
  );
}

type Common = { label: string; supporting?: ReactNode; leadingIcon?: string; trailing?: ReactNode };

function useFocus<E>(props: { onFocus?: (e: React.FocusEvent<E>) => void; onBlur?: (e: React.FocusEvent<E>) => void }) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: {
      onFocus: (e: React.FocusEvent<E>) => {
        setFocused(true);
        props.onFocus?.(e);
      },
      onBlur: (e: React.FocusEvent<E>) => {
        setFocused(false);
        props.onBlur?.(e);
      },
    },
  };
}

const inputCls = "h-14 w-full bg-transparent px-4 type-body-large outline-none caret-primary";

export function TextField({ label, supporting, leadingIcon, trailing, className, onFocus, onBlur, ...props }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const { focused, handlers } = useFocus<HTMLInputElement>({ onFocus, onBlur });
  // Date/time inputs always show their own placeholder, so their label stays floated.
  const alwaysFloated = props.type === "date" || props.type === "time";
  const floated = focused || alwaysFloated || (props.value !== undefined && props.value !== "");
  return (
    <Frame {...{ id, label, floated, focused, leadingIcon, trailing, supporting, className }}>
      <input id={id} className={`${inputCls} ${leadingIcon ? "pl-4" : ""}`} {...props} {...handlers} />
    </Frame>
  );
}

export function TextArea({ label, supporting, className, onFocus, onBlur, ...props }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const { focused, handlers } = useFocus<HTMLTextAreaElement>({ onFocus, onBlur });
  const floated = focused || (props.value !== undefined && props.value !== "");
  return (
    <Frame {...{ id, label, floated, focused, supporting, className }} multiline>
      <textarea id={id} className="type-body-large block w-full resize-none bg-transparent px-4 py-4 caret-primary outline-none" {...props} {...handlers} />
    </Frame>
  );
}

/** Select styled as an outlined field (native picker for good mobile UX). Label is always floated. */
export function SelectField({ label, supporting, className, children, onFocus, onBlur, ...props }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const { focused, handlers } = useFocus<HTMLSelectElement>({ onFocus, onBlur });
  return (
    <Frame
      {...{ id, label, focused, supporting, className }}
      floated
      trailing={<Icon name="expand_more" className={`pointer-events-none mr-3 ${focused ? "text-primary" : "text-on-surface-variant"}`} />}
    >
      <select id={id} className={`${inputCls} cursor-pointer appearance-none pr-2`} {...props} {...handlers}>
        {children}
      </select>
    </Frame>
  );
}
