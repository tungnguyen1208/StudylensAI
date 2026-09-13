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
    <fieldset disabled={disabled} aria-label="Các lựa chọn trả lời">
      {options.map((option) => (
        <label key={option.optionId} style={{ display: 'block', margin: '8px 0' }}>
          <input
            type="radio"
            name={name}
            value={option.optionId}
            checked={selectedOptionId === option.optionId}
            onChange={() => onChange(option.optionId)}
          />{' '}
          {option.text}
        </label>
      ))}
    </fieldset>
  );
}
