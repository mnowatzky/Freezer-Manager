import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon } from "./Icon";

/*
 * M3 filled text field. The label floats up when the field is focused or filled
 * (CSS-only via :placeholder-shown), and the active indicator thickens on focus.
 */

const container =
  "group relative rounded-t-xs bg-surface-container-highest text-on-surface transition-colors focus-within:bg-surface-container-highest " +
  "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-on-surface-variant after:transition-all after:duration-200 " +
  "focus-within:after:h-0.5 focus-within:after:bg-primary has-[:invalid:not(:placeholder-shown)]:after:bg-error";

const labelCls =
  "pointer-events-none absolute left-4 top-1/2 origin-left -translate-y-1/2 text-on-surface-variant transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)] type-body-large " +
  "peer-focus:top-2 peer-focus:translate-y-0 peer-focus:type-body-small peer-focus:text-primary " +
  "peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:type-body-small";

const fieldCls = "peer w-full bg-transparent px-4 pt-6 pb-2 type-body-large outline-none placeholder:text-transparent";

type Common = { label: string; supporting?: ReactNode; leadingIcon?: string; trailing?: ReactNode };

export function TextField({ label, supporting, leadingIcon, trailing, className = "", ...props }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      <div className={`${container} flex items-center`}>
        {leadingIcon && <Icon name={leadingIcon} className="ml-3 text-on-surface-variant" />}
        <div className="relative min-w-0 flex-1">
          <input id={id} placeholder=" " className={`${fieldCls} h-14`} {...props} />
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
        </div>
        {trailing}
      </div>
      {supporting && <div className="type-body-small px-4 pt-1 text-on-surface-variant">{supporting}</div>}
    </div>
  );
}

export function TextArea({ label, className = "", ...props }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={`${container} ${className}`}>
      <textarea id={id} placeholder=" " className={`${fieldCls} resize-none`} {...props} />
      <label htmlFor={id} className={labelCls.replace("top-1/2", "top-4").replace("-translate-y-1/2", "")}>
        {label}
      </label>
    </div>
  );
}

/** Select styled as a filled text field (native picker for good mobile UX). */
export function SelectField({ label, className = "", children, ...props }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`${container} ${className}`}>
      <select id={id} className="h-14 w-full cursor-pointer appearance-none bg-transparent px-4 pt-6 pb-2 pr-10 type-body-large outline-none" {...props}>
        {children}
      </select>
      <label htmlFor={id} className="type-body-small pointer-events-none absolute top-2 left-4 text-on-surface-variant group-focus-within:text-primary">
        {label}
      </label>
      <Icon name="expand_more" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant" />
    </div>
  );
}
