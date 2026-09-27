import React from 'react';

const Button = ({ onClick, children, variant = 'primary', className = '', disabled = false, type = 'button', ...props }) => {
  const baseStyle = 'px-4 py-2 rounded font-semibold focus:outline-none focus:ring-2 focus:ring-opacity-50 transition-colors duration-150 ease-in-out';
  
  let variantStyle = '';
  switch (variant) {
    case 'primary':
      variantStyle = 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500';
      break;
    case 'secondary':
      variantStyle = 'bg-gray-500 hover:bg-gray-600 text-white focus:ring-gray-400';
      break;
    case 'danger':
      variantStyle = 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500';
      break;
    case 'success':
      variantStyle = 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-400';
      break;
    case 'outline':
      variantStyle = 'bg-transparent hover:bg-gray-100 text-gray-700 border border-gray-300 focus:ring-gray-400 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700';
      break;
    case 'ghost':
      variantStyle = 'bg-transparent hover:bg-gray-100 text-blue-600 focus:ring-blue-400 dark:hover:bg-gray-700 dark:text-blue-400';
      break;
    default:
      variantStyle = 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500';
  }

  const disabledStyle = disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md';

  return (
    <button
      type={type}
      onClick={onClick}
      className={`${baseStyle} ${variantStyle} ${disabledStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
