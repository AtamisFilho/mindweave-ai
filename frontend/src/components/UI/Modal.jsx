import React from 'react';

const Modal = ({ isOpen, onClose, title, children, footerContent, size = 'md' }) => {
  if (!isOpen) return null;

  let sizeClass = 'max-w-md'; // Default medium
  if (size === 'sm') sizeClass = 'max-w-sm';
  if (size === 'lg') sizeClass = 'max-w-lg';
  if (size === 'xl') sizeClass = 'max-w-xl';


  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 transition-opacity duration-300 ease-in-out"
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full ${sizeClass} mx-auto transform transition-all duration-300 ease-in-out scale-95 opacity-0 animate-modalShow`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          </div>
        )}
        <div className="text-sm text-gray-700 dark:text-gray-300 mb-4 max-h-[60vh] overflow-y-auto">
          {children}
        </div>
        {footerContent && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
            {footerContent}
          </div>
        )}
      </div>
      {/* A animação animate-modalShow está definida em src/index.css */}
    </div>
  );
};

export default Modal;
