# Wakame Japanese Linter

日本語文章の解析・校正を行うVSCode拡張機能です。インストールするだけで動作します。

> [MoZuku](https://github.com/t3tra-dev/MoZuku)にインスパイアされ、TypeScript + kuromoji.jsで再実装しました。

## 機能

- **形態素解析**: kuromoji.jsによる高精度な日本語トークン化
- **文法チェック**:
  - 二重助詞の検出（をを、がが等）
  - 助詞連続の検出
  - 読点制限（一文に使用できる読点の数を制限）
  - 逆接「が」の重複検出
  - 接続詞重複の検出
  - ら抜き言葉の検出
- **セマンティックハイライト**: 品詞ごとの色分け表示
- **ホバー情報**: 単語の品詞、読み、基本形などを表示

## 対応ファイル形式

- プレーンテキスト (.txt)
- Markdown (.md)
- HTML
- LaTeX
- JavaScript/TypeScript (コメント内)
- Python (コメント内)
- Rust (コメント内)
- C/C++ (コメント内)

## インストール

1. VSCode拡張機能からインストール
2. または `.vsix` ファイルからインストール:
   ```bash
   code --install-extension wakame-lsp-0.1.0.vsix
   ```

## 設定

`settings.json` で以下の設定が可能です:

```json
{
  "wakame.enable": true,
  "wakame.targetLanguages": ["plaintext", "markdown", "japanese", "latex", "html"],
  "wakame.minJapaneseRatio": 0.1,
  "wakame.rules.commaLimit": true,
  "wakame.rules.commaLimitMax": 3,
  "wakame.rules.adversativeGa": true,
  "wakame.rules.adversativeGaMax": 1,
  "wakame.rules.duplicateParticle": true,
  "wakame.rules.adjacentParticles": true,
  "wakame.rules.conjunctionRepeat": true,
  "wakame.rules.raDropping": true
}
```

## 開発

```bash
# 依存関係をインストール
npm install

# ビルド
npm run build

# ウォッチモード
npm run watch

# 型チェック
npm run typecheck

# リント
npm run lint

# パッケージ化
npm run package
```

## ライセンス

MIT

## クレジット

- [kuromoji.js](https://github.com/takuyaa/kuromoji.js) - Japanese morphological analyzer
- [MoZuku](https://github.com/t3tra-dev/MoZuku) - Original grammar rules inspiration
