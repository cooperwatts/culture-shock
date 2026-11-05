import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (describedBy: string | undefined) => ReactNode;
}

/**
 * Associates hint and error text with the control through aria-describedby, so
 * validation failures are announced rather than only shown in red.
 *
 * The control is pushed to the bottom of the field so that inputs line up
 * across a grid row even when only some of them carry hint text.
 */
function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex h-full flex-col">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {hint ? (
        <p
          id={hintId}
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
      <div className="mt-auto pt-1.5">{children(describedBy)}</div>
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASSES =
  "w-full min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm aria-[invalid=true]:border-destructive";

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function TextField({
  id,
  label,
  hint,
  error,
  ...props
}: TextFieldProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={props.required}
    >
      {(describedBy) => (
        <input
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={CONTROL_CLASSES}
        />
      )}
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  ...props
}: TextAreaFieldProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={props.required}
    >
      {(describedBy) => (
        <textarea
          rows={4}
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={CONTROL_CLASSES}
        />
      )}
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id"
> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
}

export function SelectField({
  id,
  label,
  hint,
  error,
  options,
  ...props
}: SelectFieldProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={props.required}
    >
      {(describedBy) => (
        <select
          {...props}
          id={id}
          aria-describedby={describedBy}
          className={CONTROL_CLASSES}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export function CheckboxField({
  id,
  label,
  hint,
  ...props
}: CheckboxFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex items-start gap-2">
      <input
        {...props}
        type="checkbox"
        id={id}
        aria-describedby={hintId}
        className="mt-1 h-5 w-5 rounded border-border"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
