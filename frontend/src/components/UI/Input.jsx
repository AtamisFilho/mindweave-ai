import React from 'react';

const Input = ({ type = 'text', value, onChange, placeholder, className = '', disabled = false, name, ref, ...props }) => {
  const baseStyle = 'px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white';
  const disabledStyle = disabled ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : '';

  return (
    <input
      ref={ref}
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`${baseStyle} ${disabledStyle} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};

export default Input;
