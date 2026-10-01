import type { QuestionOptionPublic } from '../types/assessment-types';

interface MultipleChoiceAnswerProps {
  name: string;
  options: QuestionOptionPublic[];
  selectedOptionId: string;
  disabled: boolean;
  onChange: (optionId: string) => void;
}

export function MultipleChoiceAnswer({ name, options, selectedOptionId, disabled, onChange }: MultipleChoiceAnswerProps) {
  return (
    <fieldset className="assessment__options" disabled={disabled} aria-label="Các lựa chọn trả lời">
      {options.map((option) => (
        <label
          key={option.optionId}
          className={`assessment__option${selectedOptionId === option.optionId ? ' assessment__option--selected' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={option.optionId}
            checked={selectedOptionId === option.optionId}
            onChange={() => onChange(option.optionId)}
          />
          <span>{option.text}</span>
        </label>
      ))}
    </fieldset>
  );
}
