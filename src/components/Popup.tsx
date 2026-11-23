interface PopupProps {
  header: string;
  subHeader: string;
  message: string;
  onClose?: () => void;
}

export function Popup({ header, subHeader, message, onClose }: PopupProps) {
  return (
    <section className="panel popup">
      <header>
        <div>
          <h2>{header}</h2>
          <small>{subHeader}</small>
        </div>
      </header>

      <div className="content net-line">
        <span>{message}</span>
      </div>
      {onClose && (
        <button className="popup-close" onClick={onClose}>
          Close
        </button>
      )}
    </section>
  );
}
