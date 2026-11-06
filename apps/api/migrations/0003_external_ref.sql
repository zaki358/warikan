-- 外部アプリ（家計簿ダッシュボード）から反映された支出に、その由来を一意に記録する。
-- SQLite の UNIQUE インデックスは NULL を重複として扱わないため、
-- 割り勘アプリ内で手入力した支出（external_ref IS NULL）は何件でも共存できる。
-- この列があることで (1) 同じエントリの二重反映を DB レベルで防ぎ、
-- (2) 連携をやめたくなったときに外部由来の行だけを正確に削除できる。
ALTER TABLE monthly_expenses ADD COLUMN external_ref TEXT;

CREATE UNIQUE INDEX idx_monthly_expenses_external_ref ON monthly_expenses(external_ref);
