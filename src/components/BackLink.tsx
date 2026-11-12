import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

/** "Back" for pages that sit under another one: returns to wherever you came from inside Taskify (the calendar, My Tasks,
 *  a person), or to `to` when the page was opened directly (a link in an email, a new tab). */
export default function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  // react-router counts in-app steps in history.state.idx; 0 means this page was the first one opened
  const inApp = (window.history.state?.idx ?? 0) > 0;
  return (
    <Link to={to} className="back-link" onClick={(e) => { if (inApp) { e.preventDefault(); navigate(-1); } }}>
      <ArrowLeft size={16} aria-hidden="true" />{inApp ? 'Back' : label}
    </Link>
  );
}
