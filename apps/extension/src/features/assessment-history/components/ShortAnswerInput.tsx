interface ShortAnswerInputProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function ShortAnswerInput({ value, disabled, onChange }: ShortAnswerInputProps) {
  return (
    <textarea
      aria-label="Câu trả lời ngắn"
      value={value}
      disabled={disabled}
      maxLength={2000}
      rows={4}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
