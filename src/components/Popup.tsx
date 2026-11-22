type PopupProps = {
    header: string,
    subHeader: string,
    message: string
}

export function Popup({header, subHeader, message}: PopupProps) {
    return (
        <section className="panel popup">
            <header>
                <div>
                    <h2>{header}</h2>
                    <small>{subHeader}</small>
                </div>
            </header>

            <div className="content net-line">
                <span>
                    {message}
                </span>
            </div>
        </section>
    );
}
