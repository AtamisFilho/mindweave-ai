import React from 'react';

const Select = ({ value, onChange, options, className = '', disabled = false, name, ...props }) => {
  const baseStyle = 'px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white';
  const disabledStyle = disabled ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : '';

  return (
    <select
      name={name}
      value={value}
      onChange={onChange}
      className={`${baseStyle} ${disabledStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default Select;
