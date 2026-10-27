const variants = {
  primary: "button button--primary",
  secondary: "button button--secondary",
  ghost: "button button--ghost",
};

export default function Button({ variant = "primary", className = "", children, ...props }) {
  return (
    <button className={`${variants[variant] ?? variants.primary} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
