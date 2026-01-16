import React from 'react';
import { TextField, TextFieldProps } from '@mui/material';
import { styled } from '@mui/material/styles';

interface ModernDatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  minDate?: string; // ISO date string (YYYY-MM-DD)
  maxDate?: string; // ISO date string (YYYY-MM-DD)
  error?: boolean;
  helperText?: string;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  margin?: 'none' | 'dense' | 'normal';
}

const StyledDateTextField = styled(TextField)(({ theme }) => ({
  '& input[type="date"]': {
    '&::-webkit-calendar-picker-indicator': {
      cursor: 'pointer',
      borderRadius: 4,
      marginLeft: 4,
      opacity: 0.6,
      transition: 'opacity 0.2s ease',
      '&:hover': {
        opacity: 1,
        background: theme.palette.action.hover,
      },
    },
    '&::-webkit-date-and-time-value': {
      textAlign: 'left',
    },
  },
  '& .MuiOutlinedInput-root': {
    transition: 'all 0.2s ease',
    '&:hover': {
      '& .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.primary.main,
      },
    },
    '&.Mui-focused': {
      '& .MuiOutlinedInput-notchedOutline': {
        borderWidth: 2,
      },
    },
  },
}));

const ModernDatePicker: React.FC<ModernDatePickerProps> = ({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  minDate,
  maxDate,
  error = false,
  helperText,
  fullWidth = true,
  size = 'medium',
  margin = 'normal',
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <StyledDateTextField
      fullWidth={fullWidth}
      label={label}
      type="date"
      value={value}
      onChange={handleChange}
      required={required}
      disabled={disabled}
      error={error}
      helperText={helperText}
      size={size}
      margin={margin}
      InputLabelProps={{
        shrink: true,
      }}
      inputProps={{
        min: minDate,
        max: maxDate,
      }}
      variant="outlined"
    />
  );
};

export default ModernDatePicker;
