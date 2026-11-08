# cc-deep-review

[English](README.md) | 日本語

Claude Code / Codexによる独立レビューを、指摘の検証と収束確認まで進めるAgent Skillです。

PRまたはコミット済みブランチを固定した入力でレビューし、指摘を実コードと照合します。新しいセッションでレビューを繰り返し、最終的な指摘が連続2ラウンド変わらなくなるか、最大20ラウンドに達した時点で結果をまとめます。

- Claude Code・Codexのどちらからも起動できます。
- 外部reviewerはClaude・Codexの両方、または片方を設定で選べます。
- 重要度と「今回のPRでどう扱うか」を分けて報告します。
- 固定SHA・入力digest・実行記録を保存し、失敗や未完了を指摘0件として扱いません。
- 対象コードを変更せず、レビュー成果物を対象リポジトリの `_tmp/reviews/` に保存します。

## 必要なもの

- Node.js 24、Git、Bash 4以上、`jq`、`rg`、一般的なUnixコマンド
- PRモードでは、対象リポジトリへアクセスできる認証済みGitHub CLI（`gh`）
- 有効にする外部reviewerのCLIと、そのCLIで利用可能なアカウント・モデル
  - Claude Code: `--safe-mode`、`--model`、`--effort`、Read/Grep/Globのtool制限に対応する版
  - Codex: `exec`、read-only sandbox、JSON出力に対応する版
- Claudeを使う場合は `shasum` または `sha256sum`

実レビューでは、対象コードと差分を選択した外部CLIに渡します。反復回数によって時間・モデル利用量が増えるため、最初は小さいPRまたはブランチで確認してください。

WindowsではGit Bashを使用し、エージェントからもGit Bash・Node・`jq`・`gh`・利用するreviewerを解決できるPATHを設定してください。macOSでは、標準のBash 3.2ではなくBash 4以上を使用してください。

## 導入

リポジトリを取得します。privateの間は、アクセス権のあるGitHubアカウントが必要です。

```bash
gh repo clone yasuhirowevo/cc-deep-review
cd cc-deep-review
```

使用するホストへスキルを配置します。

```bash
# Codex用: ~/.agents/skills/cc-deep-review/
node scripts/install.mjs --target agents

# Claude Code用: ~/.claude/skills/cc-deep-review/
node scripts/install.mjs --target claude

# 両方へ導入する場合は、上の2つの代わりに実行
node scripts/install.mjs --target both
```

インストーラーはスキル本体をコピーし、設定ファイルが存在しない場合だけ設定例を作成します。既存のスキルがあるときは、通常の導入を中止します。

### 1. reviewerを設定する

`~/.config/cc-deep-review/reviewer.env` を編集します。[設定例](config/reviewer.env.example)のモデル・推論設定の空欄を、各CLIで利用できる値に置き換えてください。空欄のままではreviewer起動前に停止します。

| 設定 | 用途 |
|---|---|
| `CLAUDE_REVIEW_ENABLED` | Claudeを使うか。`true` / `false` |
| `CODEX_REVIEW_ENABLED` | Codexを使うか。`true` / `false` |
| `CLAUDE_REVIEW_MODEL` / `CLAUDE_REVIEW_EFFORT` | Claude有効時のモデル・推論設定 |
| `CODEX_REVIEW_MODEL` / `CODEX_REVIEW_REASONING_EFFORT` | Codex有効時のモデル・推論設定 |

片方だけ使う場合は無効側のモデル・推論設定の行を削除するかコメントアウトしてください。両方無効にはできません。環境変数で同じキーを指定すると設定ファイルより優先されます。`DEEP_REVIEW_CONFIG_FILE` で別の設定ファイルを指定することもできます。

### 2. ホストを設定する

インストーラーは、実際の配置パスを使った設定ファイルを `~/.config/cc-deep-review/setup/` に生成します。

**Codex:** 固定ランチャーを都度の承認なしで起動したい場合、生成された `cc-deep-review.rules` を `~/.codex/rules/cc-deep-review.rules` として配置します。許可はpreflightと検証付きランチャーの固定パスに限定しています。実行基盤の管理ポリシーは引き続き適用されます。

**Claude Code:** 生成された `claude-settings.json` の `env.BASH_MAX_TIMEOUT_MS` を、自分の `~/.claude/settings.json` の `env` に統合してください。長時間のreviewer実行を待つため、`2400000` ミリ秒を使用します。`permissions.allow` は固定ランチャーの呼び出しを事前許可したい場合に既存配列へ追加します。

設定例で既存の設定ファイル全体を置き換えないでください。インストーラーはホストの設定・許可ルールを自動変更しません。

ホストがスキル一覧を更新した後、新しいセッションから使用します。

## 使い方

レビュー対象のGitリポジトリを開き、エージェントへ指示します。

```text
$cc-deep-review 123

$cc-deep-review https://github.com/OWNER/REPO/pull/123

$cc-deep-review --branch feature/example --base main
```

Claude Codeでは `/cc-deep-review` の呼び出しも使用できます。ブランチモードはコミット済みの内容を対象とし、未コミット変更は含みません。

レビュー完了時にレポートの絶対パスと所要時間を返します。レポートでは、問題の重要度と今回の取扱いをそれぞれ確認できます。レビュー中のCLI失敗や入力不整合は、未完了として報告されます。

詳しい手順は [SKILL.md](skills/cc-deep-review/SKILL.md)、守るべき原則は [CONSTITUTION.md](skills/cc-deep-review/CONSTITUTION.md) を参照してください。

## 更新・設定管理との併用

このリポジトリをスキル本体の更新元とし、個人のdotfiles等ではreviewer設定と導入方法を管理できます。特定の版を使う場合は、このリポジトリのコミットを固定してから導入してください。

```bash
git pull --ff-only
node scripts/install.mjs --target both --replace
```

`--replace` は導入済みのスキルを `~/.config/cc-deep-review/backups/` に退避してから更新します。ローカルで編集していた内容もバックアップへ残します。reviewer設定は保持します。更新後は必要に応じて生成済みのホスト設定を反映してください。

インストール先のスキル本体を別のリポジトリでも編集・管理すると、更新元が二重になります。導入済みの本体は生成物として扱い、変更はこのリポジトリへ反映する運用を推奨します。

## 開発・検証

外部AIに接続しないテストです。

```bash
node --test tests/install.test.mjs
bash skills/cc-deep-review/scripts/test-regression.sh
```

GitHub Actionsでは、導入テストをLinux・macOS・Windowsで、レビューの回帰テストをLinuxで実行します。テスト用のホスト設定を生成するため、開発者の個人設定は不要です。

Windowsの回帰テストには、Bash製のfake CLIをWin32 Nodeから直接起動できないケースがあります。全体の回帰検証はLinuxで実行してください。実際のモデルを使うsmokeテストの手順は [回帰検証](skills/cc-deep-review/references/regression-verification.md) に記載しています。fake CLIのテスト成功だけでは、外部CLIのバージョン差や実モデルのレビュー品質は保証されません。

## ライセンス

[MIT](LICENSE)
