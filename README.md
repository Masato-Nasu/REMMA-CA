# Recursive Lemma CA (edge)
再帰レンマ 4値ロジスティック・スキン + 1/f揺らぎ + エッジ強調

<p align="center">
  <img src="screenshot.png" width="360" alt="Recursive Lemma CA (edge) screenshot" />
</p>

**Recursive Lemma CA (edge)** は、

- 4値セルオートマトン
- 近傍平均 × ロジスティック写像
- 慣性ブレンド
- レンマ・ループ（3×3 パターンごとの ±1 補正）
- レンマの「退屈さ」に応じた学習・変異
- 1/f揺らぎ
- **境界（エッジ）を優遇する局所慣性 / 更新確率**

を組み合わせた、「筋・フィラメント多め」の再帰レンマ CA 派生版です。

従来版との違いは：

- 3×3 近傍の **min/max の差（edge = maxV - minV）** を評価し、
  - edge = 0（内部）ではスライダー通りの慣性・更新割合
  - edge ≥ 1（境界）では局所慣性を弱め、更新割合を上乗せ
- その結果、**領域と領域の境界がよく動き、筋・フィラメントとして残りやすくなる**

という点です。

---

## ファイル構成

- `index.html`  
- `app.js`  
- `manifest.json`  
- `sw.js`  
- `screenshot.png`  
- `icon-192.png` / `icon-512.png`  

をルートに配置すれば、そのままブラウザで動作します。

---

## インストール（PWA）

1. このフォルダ一式を GitHub リポジトリにアップロード。
2. 「Settings → Pages」で GitHub Pages を有効にする。
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` をスマホで開く。
4. ブラウザの「ホーム画面に追加」から PWA としてインストール。

---

より強く「筋だらけ」にしたい場合は、`app.js` 内の：

- `localInertia` の係数（0.7 / 0.5）
- `cellUpdateProb` の増分（`+ 0.15 * edge`）

を少しずつ大きめにして実験してみてください。
