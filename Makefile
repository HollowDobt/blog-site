# Makefile
# -----------------------------
# 变量 MSG：提交说明，可运行时覆盖
MSG ?= 新文章

# 默认目标
.DEFAULT_GOAL := push

.PHONY: push
push:
	@git add .
	@git commit -m "$(MSG)" || echo "Nothing to commit."
	@git push
