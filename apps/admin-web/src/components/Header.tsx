export default function Header({
  adminName,
  onLogout,
}: {
  adminName: string;
  onLogout: () => void;
}) {
  return (
    <header className="app-header">
      <div className="account">
        <span>{adminName}</span>
        <button type="button" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}
