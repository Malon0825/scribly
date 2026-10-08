import { AnimatedIcon } from "./AnimatedIcon";
import * as Select from "@radix-ui/react-select";
import { CaretDown, CaretUp, Check } from "@phosphor-icons/react";
import { useRef, type ComponentProps } from 'react';
import { useSurfaceMotion } from './useSurfaceMotion';

function MotionSelectContent({ motionLabel, ...props }: ComponentProps<typeof Select.Content> & { motionLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useSurfaceMotion(ref, 'menu', `select-${motionLabel}`);
  return <Select.Content {...props} ref={ref} />;
}

export type SelectOption = { value: string; label: string; group?: string };
// Radix owns focus, typeahead, keyboard navigation and collision placement.
// Every picker uses the same application surface instead of an OS popup.
export function AppSelect({ value, options, onChange, label, title, id, describedBy, className = "", onCloseFocus, disabled = false }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
  label: string; id?: string; describedBy?: string; className?: string; onCloseFocus?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const groups = [...new Set(options.map((option) => option.group || ""))];
  return <Select.Root disabled={disabled} value={`option:${value}`} onValueChange={(next) => { if (next.startsWith("option:")) onChange(next.slice(7)); }}>
    <Select.Trigger id={id} title={title} aria-label={label} aria-describedby={describedBy} className={`app-select ${className}`}>
      <Select.Value /><Select.Icon className="select-caret"><AnimatedIcon kind="down" size={16} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <MotionSelectContent motionLabel={label} className="select-popup" data-notify-select-content="" position="popper" sideOffset={6} collisionPadding={10}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={onCloseFocus ? (event) => { event.preventDefault(); onCloseFocus(); } : undefined}>
        <Select.ScrollUpButton className="select-scroll"><CaretUp size={16} /></Select.ScrollUpButton>
        <Select.Viewport className="select-viewport">
          {groups.map((group) => <Select.Group key={group}>
            {group && <Select.Label className="select-group-label">{group}</Select.Label>}
            {options.filter((option) => (option.group || "") === group).map((option) => <Select.Item className="select-option" key={option.value} value={`option:${option.value}`} textValue={option.label}>
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="select-check"><Check size={16} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Group>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="select-scroll"><CaretDown size={16} /></Select.ScrollDownButton>
      </MotionSelectContent>
    </Select.Portal>
  </Select.Root>;
}
