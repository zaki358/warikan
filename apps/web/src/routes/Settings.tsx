import { Link } from "react-router";

import { ErrorBanner } from "../components/ErrorBanner.js";
import { UserNameRow } from "../features/users/UserNameRow.js";
import { useRenameUser, useUsers } from "../features/users/queries.js";

export function Settings() {
  const users = useUsers();
  const renameUser = useRenameUser();

  const error = users.error ?? renameUser.error;

  return (
    <>
      <div className="card">
        <h1>設定</h1>
        <p className="sub">表示名を変更できます。</p>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <h2>表示名</h2>
        {users.isLoading ? (
          <p className="sub">読み込み中…</p>
        ) : (
          (users.data ?? []).map((user) => (
            <UserNameRow
              key={user.userId}
              user={user}
              isSubmitting={renameUser.isPending && renameUser.variables?.userId === user.userId}
              onSubmit={(displayName) => renameUser.mutate({ userId: user.userId, displayName })}
            />
          ))
        )}
      </div>

      <div className="card">
        <Link className="btn btn-secondary" to="/">
          ホーム
        </Link>
      </div>
    </>
  );
}
