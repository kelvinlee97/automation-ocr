/**
 * OCR Dashboard 前端逻辑
 * 模块：StatusBar / ReceiptTable / DetailPanel / RealtimeClient
 */
(function () {
    "use strict";

    // API 基础路径（相对于当前域名）
    var API_BASE = "/api";
    var WS_BASE = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;

    // ── 分页状态 ──────────────────────────────────

    var PAGE_SIZE = 20;
    var currentOffset = 0;
    var totalRecords = 0;
    var currentPhone = "";
    var allRecords = []; // 当前页的记录

    // ── DOM 引用 ──────────────────────────────────

    var $body = document.getElementById("receiptsBody");
    var $pageInfo = document.getElementById("pageInfo");
    var $prevBtn = document.getElementById("prevBtn");
    var $nextBtn = document.getElementById("nextBtn");
    var $phoneSearch = document.getElementById("phoneSearch");
    var $refreshBtn = document.getElementById("refreshBtn");
    var $detailPanel = document.getElementById("detailPanel");
    var $closeDetail = document.getElementById("closeDetail");
    var $stepsContainer = document.getElementById("stepsContainer");
    var $totalDuration = document.getElementById("totalDuration");
    var $rawTextContent = document.getElementById("rawTextContent");
    var $receiptImage = document.getElementById("receiptImage");
    var $ocrDot = document.getElementById("ocrDot");
    var $ocrStatus = document.getElementById("ocrStatus");
    var $wsDot = document.getElementById("wsDot");
    var $wsStatus = document.getElementById("wsStatus");
    var $processedCount = document.getElementById("processedCount");

    // ── 安全工具 ──────────────────────────────────

    /** HTML 转义，防止 XSS */
    function esc(str) {
        if (str === null || str === undefined) return "";
        var div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    // ── StatusBar ─────────────────────────────────

    var StatusBar = {
        intervalId: null,

        start: function () {
            this.fetch();
            this.intervalId = setInterval(this.fetch.bind(this), 15000);
        },

        fetch: function () {
            apiGet("/status").then(function (data) {
                $ocrDot.className = "dot healthy";

                var uptime = data.ocr.uptimeSeconds;
                var hours = Math.floor(uptime / 3600);
                var mins = Math.floor((uptime % 3600) / 60);
                $ocrStatus.textContent = "运行 " + hours + "h" + mins + "m";

                $processedCount.textContent = data.ocr.processedCount;
            }).catch(function () {
                $ocrDot.className = "dot error";
                $ocrStatus.textContent = "离线";
            });
        }
    };

    // ── ReceiptTable ──────────────────────────────

    var ReceiptTable = {
        load: function () {
            var params = "?offset=" + currentOffset + "&limit=" + PAGE_SIZE;
            if (currentPhone) params += "&phone=" + encodeURIComponent(currentPhone);

            apiGet("/receipts" + params).then(function (data) {
                allRecords = data.items;
                totalRecords = data.total;
                ReceiptTable.render();
                ReceiptTable.updatePagination();
            }).catch(function () {
                $body.innerHTML = '<tr class="empty-row"><td colspan="7">加载失败</td></tr>';
            });
        },

        render: function () {
            if (allRecords.length === 0) {
                $body.innerHTML = '<tr class="empty-row"><td colspan="7">暂无记录</td></tr>';
                return;
            }

            // 清空后用 DOM API 构建行，避免 innerHTML + 动态数据的 XSS 风险
            $body.innerHTML = "";
            allRecords.forEach(function (r) {
                var tr = ReceiptTable.buildRow(r);
                $body.appendChild(tr);
            });
        },

        /** 用 DOM API 构建表格行（安全） */
        buildRow: function (r) {
            var tr = document.createElement("tr");
            tr.setAttribute("data-id", r.id);

            var amountText = r.amount != null ? "RM " + r.amount.toFixed(2) : "--";
            var cells = [
                formatTime(r.timestamp),
                maskPhone(r.phone),
                r.brand || "--",
                amountText,
                null, // 合格列特殊处理
                r.confidence ? (r.confidence * 100).toFixed(0) + "%" : "--",
                r.totalDurationMs > 0 ? (r.totalDurationMs / 1000).toFixed(1) + "s" : "--"
            ];

            cells.forEach(function (text, i) {
                var td = document.createElement("td");
                if (i === 4) {
                    // 合格状态列
                    var badge = document.createElement("span");
                    if (!r.success) {
                        badge.className = "badge badge-error";
                        badge.textContent = "失败";
                    } else if (r.qualified) {
                        badge.className = "badge badge-success";
                        badge.textContent = "合格";
                    } else {
                        badge.className = "badge badge-warning";
                        badge.textContent = "不合格";
                    }
                    td.appendChild(badge);
                } else {
                    td.textContent = text;
                }
                tr.appendChild(td);
            });

            // 点击展开详情
            tr.addEventListener("click", function () {
                DetailPanel.show(r);
                // 高亮当前行
                var rows = $body.querySelectorAll("tr[data-id]");
                rows.forEach(function (row) { row.classList.remove("active"); });
                tr.classList.add("active");
            });

            return tr;
        },

        updatePagination: function () {
            var totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
            var currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;

            $pageInfo.textContent = "第 " + currentPage + " / " + totalPages + " 页（共 " + totalRecords + " 条）";
            $prevBtn.disabled = currentOffset <= 0;
            $nextBtn.disabled = currentOffset + PAGE_SIZE >= totalRecords;
        },

        /** 将新记录插入表格顶部（实时推送用） */
        prepend: function (record) {
            allRecords.unshift(record);
            totalRecords++;

            // 在表格顶部插入新行
            var tr = this.buildRow(record);
            tr.classList.add("flash-new");
            if ($body.firstChild) {
                $body.insertBefore(tr, $body.firstChild);
            } else {
                $body.innerHTML = "";
                $body.appendChild(tr);
            }

            this.updatePagination();
            $processedCount.textContent = totalRecords;

            setTimeout(function () { tr.classList.remove("flash-new"); }, 2000);
        }
    };

    // ── DetailPanel ───────────────────────────────

    var STEP_LABELS = {
        save_image: "保存图片",
        preprocess: "图像预处理",
        ocr: "OCR 识别",
        extract: "字段提取",
        eligibility: "资格验证",
        write_excel: "写入 Excel"
    };

    var DetailPanel = {

        show: function (record) {
            $detailPanel.classList.remove("hidden");

            // 填充编辑表单
            $editRecordId.value = record.id;
            $editReceiptNo.value = record.receiptNo || "";
            $editBrand.value = record.brand || "";
            $editAmount.value = record.amount !== null ? record.amount.toFixed(2) : "";
            $editQualified.value = record.qualified ? "true" : "false";
            $editReason.value = record.disqualifyReason || "";
            $saveStatus.textContent = "";

            // 总耗时

            $totalDuration.textContent = record.totalDurationMs > 0
                ? "总耗时 " + record.totalDurationMs.toFixed(0) + "ms"
                : "无耗时数据";

            // 渲染步骤 Timeline
            this.renderSteps(record.steps, record.totalDurationMs);

            // 原始文本（用 textContent，天然安全）
            $rawTextContent.textContent = record.rawText || "（无数据）";

            // 图片
            if (record.id && record.imagePath) {
                $receiptImage.src = API_BASE + "/receipts/" + encodeURIComponent(record.id) + "/image";
                $receiptImage.style.display = "block";
            } else {
                $receiptImage.style.display = "none";
            }
        },

        renderSteps: function (steps, totalMs) {
            $stepsContainer.innerHTML = "";

            if (!steps || steps.length === 0) {
                var noSteps = document.createElement("div");
                noSteps.className = "no-steps";
                noSteps.textContent = "此记录无步骤详情（历史回填数据）";
                $stepsContainer.appendChild(noSteps);
                return;
            }

            steps.forEach(function (step) {
                var item = document.createElement("div");
                item.className = "step-item" + (step.status === "failed" ? " failed" : "");

                var nameSpan = document.createElement("span");
                nameSpan.className = "step-name";
                nameSpan.textContent = STEP_LABELS[step.name] || step.name;

                var durationSpan = document.createElement("span");
                durationSpan.className = "step-duration";
                durationSpan.textContent = step.durationMs.toFixed(0) + "ms";

                var detailDiv = document.createElement("div");
                detailDiv.className = "step-detail";
                detailDiv.textContent = DetailPanel.formatDetail(step);

                // 耗时条
                var bar = document.createElement("div");
                bar.className = "duration-bar";
                var barWidth = totalMs > 0
                    ? Math.max(2, Math.round((step.durationMs / totalMs) * 100))
                    : 0;
                bar.style.width = barWidth + "%";
                detailDiv.appendChild(bar);

                item.appendChild(nameSpan);
                item.appendChild(durationSpan);
                item.appendChild(detailDiv);
                $stepsContainer.appendChild(item);
            });
        },

        formatDetail: function (step) {
            var d = step.detail || {};
            switch (step.name) {
                case "save_image":
                    return d.fileSize ? (d.fileSize / 1024).toFixed(1) + " KB" : "";
                case "preprocess":
                    var flags = [];
                    if (d.grayscale) flags.push("灰度");
                    if (d.enhanceContrast) flags.push("CLAHE");
                    if (d.denoise) flags.push("去噪");
                    return flags.join(" + ");
                case "ocr":
                    var parts = [];
                    if (d.textBlockCount !== undefined) parts.push(d.textBlockCount + " 个文本块");
                    if (d.avgConfidence !== undefined) parts.push("置信度 " + (d.avgConfidence * 100).toFixed(0) + "%");
                    return parts.join("，");
                case "extract":
                    var extractParts = [];
                    if (d.matchedBrand) extractParts.push(d.matchedBrand);
                    if (d.amount != null) extractParts.push("RM " + d.amount.toFixed(2));
                    if (d.receiptNo) extractParts.push("单据号: " + d.receiptNo);
                    return extractParts.length > 0 ? extractParts.join("，") : "未识别到字段";
                case "eligibility":
                    if (d.qualified) return "合格";
                    return d.reason || "不合格";
                case "write_excel":
                    return d.written ? "已写入" : "";
                default:
                    return JSON.stringify(d);
            }
        },

        hide: function () {
            $detailPanel.classList.add("hidden");
            var rows = $body.querySelectorAll("tr.active");
            rows.forEach(function (r) { r.classList.remove("active"); });
        }
    };

    // ── RealtimeClient ────────────────────────────

    var MAX_WS_RETRIES = 3;
    var wsRetryCount = 0;
    var ws = null;
    var pollIntervalId = null;

    var RealtimeClient = {
        connect: function () {
            if (ws && ws.readyState <= 1) return;

            ws = new WebSocket(WS_BASE + "/ws/events");

            ws.onopen = function () {
                wsRetryCount = 0;
                $wsDot.className = "dot healthy";
                $wsStatus.textContent = "已连接";
                RealtimeClient.stopPolling();
            };

            ws.onmessage = function (e) {
                try {
                    var event = JSON.parse(e.data);
                    if (event.type === "new_receipt" && currentOffset === 0) {
                        ReceiptTable.prepend(event.data);
                    }
                } catch (err) {
                    // 忽略解析错误
                }
            };

            ws.onclose = function () {
                $wsDot.className = "dot error";
                $wsStatus.textContent = "断开";

                if (wsRetryCount < MAX_WS_RETRIES) {
                    var delay = 1000 * Math.pow(2, wsRetryCount);
                    wsRetryCount++;
                    $wsStatus.textContent = "重连中...";
                    setTimeout(function () { RealtimeClient.connect(); }, delay);
                } else {
                    $wsStatus.textContent = "轮询模式";
                    RealtimeClient.startPolling();
                }
            };

            ws.onerror = function () {
                // onclose 会接着触发，不重复处理
            };
        },

        startPolling: function () {
            if (pollIntervalId) return;
            pollIntervalId = setInterval(function () {
                if (currentOffset === 0) {
                    ReceiptTable.load();
                }
            }, 5000);
        },

        stopPolling: function () {
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
        }
    };

    // ── 工具函数 ──────────────────────────────────

    function apiGet(path) {
        return fetch(API_BASE + path).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        });
    }

    function formatTime(isoStr) {
        if (!isoStr) return "--";
        try {
            var d = new Date(isoStr);
            return d.toLocaleString("zh-CN", {
                timeZone: "Asia/Kuala_Lumpur",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        } catch (e) {
            return isoStr.slice(0, 19);
        }
    }

    function maskPhone(phone) {
        if (!phone) return "--";
        // 60123456789 → 6012***6789
        if (phone.length > 7) {
            return phone.slice(0, 4) + "***" + phone.slice(-4);
        }
        return phone;
    }

    // ── 事件绑定 ──────────────────────────────────

    $refreshBtn.addEventListener("click", function () {
        currentOffset = 0;
        ReceiptTable.load();
        StatusBar.fetch();
    });

    var searchTimer = null;
    $phoneSearch.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            currentPhone = $phoneSearch.value.trim();
            currentOffset = 0;
            ReceiptTable.load();
        }, 400);
    });

    $prevBtn.addEventListener("click", function () {
        if (currentOffset > 0) {
            currentOffset -= PAGE_SIZE;
            if (currentOffset < 0) currentOffset = 0;
            ReceiptTable.load();
        }
    });

    $nextBtn.addEventListener("click", function () {
        if (currentOffset + PAGE_SIZE < totalRecords) {
            currentOffset += PAGE_SIZE;
            ReceiptTable.load();
        }
    });

    $closeDetail.addEventListener("click", function () {
        DetailPanel.hide();
    });

    $reviewForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var recordId = $editRecordId.value;
        if (!recordId) return;

        var amountVal = parseFloat($editAmount.value);
        var payload = {
            receiptNo: $editReceiptNo.value || null,
            brand: $editBrand.value || null,
            amount: isNaN(amountVal) ? null : amountVal,
            qualified: $editQualified.value === "true",
            disqualifyReason: $editReason.value || null
        };

        $saveReviewBtn.disabled = true;
        $saveReviewBtn.textContent = "保存中...";
        $saveStatus.textContent = "";

        fetch(API_BASE + "/receipts/" + recordId, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(function(res) {
            if (!res.ok) throw new Error("网络响应不是 ok");
            return res.json();
        })
        .then(function(data) {
            if (data.detail) throw new Error(data.detail);
            $saveStatus.textContent = "✔ 保存成功";
            $saveStatus.style.color = "#2ea44f";
            
            // 更新本地数据并重绘表格
            var index = allRecords.findIndex(function(r) { return r.id === recordId; });
            if (index !== -1) {
                allRecords[index] = data.record;
                ReceiptTable.render(); var newTr = document.querySelector("tr[data-id=\x27" + recordId + "\x27]"); if (newTr) newTr.classList.add("active");
            }
            
            setTimeout(function() { $saveStatus.textContent = ""; }, 3000);
        })
        .catch(function(err) {
            $saveStatus.textContent = "✘ 失败: " + err.message;
            $saveStatus.style.color = "#d73a49";
        })
        .finally(function() {
            $saveReviewBtn.disabled = false;
            $saveReviewBtn.textContent = "保存审核结果";
        });
    });


    // ESC 关闭详情面板
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") DetailPanel.hide();
    });

    // ── 初始化 ────────────────────────────────────

    StatusBar.start();
    ReceiptTable.load();
    RealtimeClient.connect();

})();
