// script.js

// ============================================================================
// 1. キャンバスとコンテキストの取得
// ============================================================================
const canvas = document.getElementById('simulationCanvas');
const ctx = canvas.getContext('2d');

// ============================================================================
// 2. シミュレーションパラメータと定数
// ============================================================================
// シミュレーションの基本的な設定値
let populationSize; // 全体の人数
let initialInfected; // 初期感染者数
let infectionProbability; // 感染確率
let recoveryTime; // 感染から回復するまでの時間（秒）
let lockdownTriggerThreshold; // ロックダウンが発動する感染者の割合（%）
let lockdownDuration; // ロックダウンの継続時間（秒）
let lockdownDivisions; // ロックダウン時のキャンバスの分割数（1軸あたり）
let infectionCheckInterval; // 感染判定を行うフレーム間隔
let vaccinationRate; // シミュレーション開始時のワクチン接種者の割合（%）

// 人の移動速度の最大値
const maxSpeed = 1.5;
// 感染判定を行う半径
const infectionRadius = 10;
// 人の描画サイズ
const personSize = 5;

// 人の状態を表す定数と色
const STATE = {
    HEALTHY: 'healthy', // 健康 (青色)
    VACCINATED_HEALTHY: 'vaccinated_healthy', // ワクチン接種済み健康 (シアン色)
    INFECTED: 'infected', // 感染 (赤色)
    VACCINATED_INFECTED: 'vaccinated_infected', // ワクチン接種済み感染 (オレンジ色)
    PERSISTENT: 'persistent', // 持続感染 (ピンク色)
    RECOVERED: 'recovered' // 回復 (緑色)
};

const COLORS = {
    [STATE.HEALTHY]: 'blue',
    [STATE.VACCINATED_HEALTHY]: 'cyan',
    [STATE.INFECTED]: 'red',
    [STATE.VACCINATED_INFECTED]: 'orange',
    [STATE.PERSISTENT]: 'pink',
    [STATE.RECOVERED]: 'green'
};

// シミュレーションの状態管理変数
let people = []; // 全ての人を格納する配列
let animationFrameId; // requestAnimationFrameのID
let simulationRunning = false; // シミュレーションが実行中かどうかのフラグ
let lockdownActive = false; // ロックダウンがアクティブかどうかのフラグ
let lockdownStartTime = 0; // ロックダウンが開始された時刻
let frameCount = 0; // フレームカウンター

// 統計情報
let stats = {
    healthy: 0,
    vaccinated_healthy: 0,
    infected: 0,
    vaccinated_infected: 0,
    persistent: 0,
    recovered: 0
};

// グラフデータ
let chartData = {
    labels: [], // 時間軸のラベル
    datasets: [
        { label: '健康', borderColor: COLORS[STATE.HEALTHY], data: [], fill: false },
        { label: 'ワクチン接種済み', borderColor: COLORS[STATE.VACCINATED_HEALTHY], data: [], fill: false },
        { label: '感染', borderColor: COLORS[STATE.INFECTED], data: [], fill: false },
        { label: '感染 (ブレークスルー)', borderColor: COLORS[STATE.VACCINATED_INFECTED], data: [], fill: false },
        { label: '持続感染', borderColor: COLORS[STATE.PERSISTENT], data: [], fill: false },
        { label: '回復', borderColor: COLORS[STATE.RECOVERED], data: [], fill: false }
    ]
};
let chart; // Chart.jsのインスタンス

// ============================================================================
// 3. Personクラス（個々のエージェント）
// ============================================================================
class Person {
    constructor(id, state, isVaccinated = false) {
        this.id = id; // 個体を識別するためのID
        this.x = Math.random() * canvas.width; // 初期X座標
        this.y = Math.random() * canvas.height; // 初期Y座標
        this.vx = (Math.random() - 0.5) * maxSpeed * 2; // X方向の速度
        this.vy = (Math.random() - 0.5) * maxSpeed * 2; // Y方向の速度
        this.state = state; // 現在の状態 (HEALTHY, INFECTEDなど)
        this.isVaccinated = isVaccinated; // ワクチン接種済みか
        this.recoveryTimer = 0; // 回復までのタイマー
        this.infectionTimer = 0; // 感染してからの経過時間
        this.gridCell = null; // ロックダウン時の所属グリッドセル

        // 感染状態の場合、感染時間を設定
        if (this.state === STATE.INFECTED || this.state === STATE.VACCINATED_INFECTED || this.state === STATE.PERSISTENT) {
            this.infectionTimer = Date.now();
        }
    }

    // 人を描画するメソッド
    draw() {
        ctx.beginPath(); // 新しいパスを開始
        ctx.arc(this.x, this.y, personSize, 0, Math.PI * 2); // 円を描画
        ctx.fillStyle = COLORS[this.state]; // 状態に応じた色を設定
        ctx.fill(); // 塗りつぶし
        ctx.closePath(); // パスを閉じる
    }

    // 人の位置と状態を更新するメソッド
    update() {
        // ロックダウンがアクティブな場合、移動範囲を制限
        if (lockdownActive && this.gridCell) {
            const cellWidth = canvas.width / lockdownDivisions;
            const cellHeight = canvas.height / lockdownDivisions;
            const minX = this.gridCell.col * cellWidth;
            const maxX = (this.gridCell.col + 1) * cellWidth;
            const minY = this.gridCell.row * cellHeight;
            const maxY = (this.gridCell.row + 1) * cellHeight;

            this.x += this.vx;
            this.y += this.vy;

            // X軸の境界チェックと跳ね返り
            if (this.x < minX + personSize || this.x > maxX - personSize) {
                this.vx *= -1;
                this.x = Math.max(minX + personSize, Math.min(this.x, maxX - personSize)); // 境界内に戻す
            }
            // Y軸の境界チェックと跳ね返り
            if (this.y < minY + personSize || this.y > maxY - personSize) {
                this.vy *= -1;
                this.y = Math.max(minY + personSize, Math.min(this.y, maxY - personSize)); // 境界内に戻す
            }
        } else {
            // ロックダウン中でない場合、キャンバス全体を自由に移動
            this.x += this.vx;
            this.y += this.vy;

            // キャンバスの境界チェックと跳ね返り
            if (this.x < personSize || this.x > canvas.width - personSize) {
                this.vx *= -1;
                this.x = Math.max(personSize, Math.min(this.x, canvas.width - personSize));
            }
            if (this.y < personSize || this.y > canvas.height - personSize) {
                this.vy *= -1;
                this.y = Math.max(personSize, Math.min(this.y, canvas.height - personSize));
            }
        }

        // 感染状態の場合、回復タイマーを更新
        if (this.state === STATE.INFECTED || this.state === STATE.VACCINATED_INFECTED || this.state === STATE.PERSISTENT) {
            const currentTime = Date.now();
            let actualRecoveryTime = recoveryTime * 1000; // 秒をミリ秒に変換

            if (this.state === STATE.VACCINATED_INFECTED) {
                // ワクチン接種済み感染者は回復時間が70%短縮
                actualRecoveryTime *= 0.3;
            } else if (this.state === STATE.PERSISTENT) {
                // 持続感染者は回復時間が3倍
                actualRecoveryTime *= 3;
            }

            // 感染から一定時間経過したら回復状態に移行
            if (currentTime - this.infectionTimer >= actualRecoveryTime) {
                this.state = STATE.RECOVERED;
                this.recoveryTimer = 0; // タイマーをリセット
            }
        }
    }

    // 他の人が感染範囲内にいるかチェックし、感染させるメソッド
    infect(otherPerson) {
        // 既に感染している、回復している、またはワクチン接種済み健康で感染しない場合は処理しない
        if (otherPerson.state === STATE.INFECTED ||
            otherPerson.state === STATE.VACCINATED_INFECTED ||
            otherPerson.state === STATE.PERSISTENT ||
            otherPerson.state === STATE.RECOVERED) {
            return;
        }

        // 距離を計算
        const dx = this.x - otherPerson.x;
        const dy = this.y - otherPerson.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 感染範囲内かつ感染確率に基づいて感染させる
        if (distance < infectionRadius) {
            let currentInfectionProbability = infectionProbability;

            // ワクチン接種済みの健康な人は感染確率が60%減少
            if (otherPerson.state === STATE.VACCINATED_HEALTHY) {
                currentInfectionProbability *= 0.4;
            }

            // 乱数と感染確率を比較して感染判定
            if (Math.random() < currentInfectionProbability) {
                // ワクチン接種済みかどうかに応じて状態を設定
                if (otherPerson.isVaccinated) {
                    otherPerson.state = STATE.VACCINATED_INFECTED; // ワクチン接種済み感染
                } else {
                    // ワクチン未接種の場合、2%の確率で持続感染
                    if (Math.random() < 0.02) {
                        otherPerson.state = STATE.PERSISTENT; // 持続感染
                    } else {
                        otherPerson.state = STATE.INFECTED; // 通常感染
                    }
                }
                otherPerson.infectionTimer = Date.now(); // 感染時間を記録
            }
        }
    }
}

// ============================================================================
// 4. シミュレーションの初期化とメインループ
// ============================================================================

// シミュレーションを初期化する関数
function initSimulation() {
    // UIから現在のパラメータ値を取得し、グローバル変数に設定
    populationSize = parseInt(document.getElementById('populationSize').value);
    initialInfected = parseInt(document.getElementById('initialInfected').value);
    infectionProbability = parseFloat(document.getElementById('infectionProbability').value);
    recoveryTime = parseInt(document.getElementById('recoveryTime').value);
    lockdownTriggerThreshold = parseInt(document.getElementById('lockdownTriggerThreshold').value);
    lockdownDuration = parseInt(document.getElementById('lockdownDuration').value);
    lockdownDivisions = parseInt(document.getElementById('lockdownDivisions').value);
    infectionCheckInterval = parseInt(document.getElementById('infectionCheckInterval').value);
    vaccinationRate = parseInt(document.getElementById('vaccinationRate').value);

    // 既存のアニメーションフレームがあればキャンセル
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    // 人の配列をクリア
    people = [];
    // 統計情報をリセット
    stats = {
        healthy: 0,
        vaccinated_healthy: 0,
        infected: 0,
        vaccinated_infected: 0,
        persistent: 0,
        recovered: 0
    };
    // グラフデータをリセット
    chartData.labels = [];
    chartData.datasets.forEach(dataset => dataset.data = []);

    // Chart.jsのインスタンスを破棄して再作成
    if (chart) {
        chart.destroy();
    }
    const chartCtx = document.getElementById('chartCanvas').getContext('2d');
    chart = new Chart(chartCtx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '時間 (秒)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '人数'
                    },
                    beginAtZero: true,
                    max: populationSize // Y軸の最大値を人口サイズに設定
                }
            }
        }
    });

    // 人を生成
    for (let i = 0; i < populationSize; i++) {
        let personState = STATE.HEALTHY;
        let isVaccinated = false;

        // ワクチン接種率に基づいてワクチン接種済みの人を生成
        if (Math.random() * 100 < vaccinationRate) {
            personState = STATE.VACCINATED_HEALTHY;
            isVaccinated = true;
        }
        people.push(new Person(i, personState, isVaccinated));
    }

    // 初期感染者を設定
    let infectedCount = 0;
    while (infectedCount < initialInfected) {
        const randomIndex = Math.floor(Math.random() * people.length);
        const person = people[randomIndex];

        // 健康な人またはワクチン接種済みの健康な人だけを感染させる
        if (person.state === STATE.HEALTHY || person.state === STATE.VACCINATED_HEALTHY) {
            if (person.isVaccinated) {
                person.state = STATE.VACCINATED_INFECTED;
            } else {
                person.state = STATE.INFECTED;
            }
            person.infectionTimer = Date.now(); // 感染時間を記録
            infectedCount++;
        }
    }

    // シミュレーション開始フラグを立てる
    simulationRunning = true;
    // フレームカウンターをリセット
    frameCount = 0;
    // ロックダウン状態をリセット
    lockdownActive = false;
    lockdownStartTime = 0;

    // シミュレーションループを開始
    updateSimulation();
}

// シミュレーションのメイン更新ループ
function updateSimulation() {
    if (!simulationRunning) {
        return;
    }

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 統計情報をリセット
    stats = {
        healthy: 0,
        vaccinated_healthy: 0,
        infected: 0,
        vaccinated_infected: 0,
        persistent: 0,
        recovered: 0
    };

    // 全ての人を更新し、統計を計算
    people.forEach(person => {
        person.update(); // 位置と状態を更新
        stats[person.state]++; // 状態ごとの人数をカウント
    });

    // 感染判定間隔ごとに感染ロジックを実行
    if (frameCount % infectionCheckInterval === 0) {
        const infectedPeople = people.filter(p =>
            p.state === STATE.INFECTED ||
            p.state === STATE.VACCINATED_INFECTED ||
            p.state === STATE.PERSISTENT
        );

        // 感染者と健康な人の間で感染判定
        infectedPeople.forEach(infectedPerson => {
            people.forEach(otherPerson => {
                // 自分自身には感染させない
                if (infectedPerson.id === otherPerson.id) return;
                infectedPerson.infect(otherPerson);
            });
        });
    }

    // ロックダウンロジック
    const totalInfected = stats.infected + stats.vaccinated_infected + stats.persistent;
    const infectedPercentage = (totalInfected / populationSize) * 100;

    // ロックダウン発動条件
    if (!lockdownActive && infectedPercentage >= lockdownTriggerThreshold) {
        lockdownActive = true;
        lockdownStartTime = Date.now(); // ロックダウン開始時刻を記録
        // ロックダウン発動時に各人のグリッドセルを決定
        people.forEach(person => {
            const cellWidth = canvas.width / lockdownDivisions;
            const cellHeight = canvas.height / lockdownDivisions;
            person.gridCell = {
                col: Math.floor(person.x / cellWidth),
                row: Math.floor(person.y / cellHeight)
            };
        });
        console.log('ロックダウン発動！');
    }

    // ロックダウン解除条件
    if (lockdownActive && (Date.now() - lockdownStartTime) >= (lockdownDuration * 1000)) {
        lockdownActive = false;
        people.forEach(person => person.gridCell = null); // グリッドセルをリセット
        console.log('ロックダウン解除！');
    }

    // ロックダウン中のグリッド線を描画
    if (lockdownActive) {
        drawLockdownGrid();
    }

    // 全ての人を描画
    people.forEach(person => person.draw());

    // 統計情報をUIに表示
    updateStatisticsDisplay();

    // グラフデータを更新 (例: 1秒ごとに更新)
    if (frameCount % 60 === 0) { // 60フレーム = 約1秒
        chartData.labels.push(Math.floor(frameCount / 60)); // 秒数をラベルに追加
        chartData.datasets[0].data.push(stats.healthy);
        chartData.datasets[1].data.push(stats.vaccinated_healthy);
        chartData.datasets[2].data.push(stats.infected);
        chartData.datasets[3].data.push(stats.vaccinated_infected);
        chartData.datasets[4].data.push(stats.persistent);
        chartData.datasets[5].data.push(stats.recovered);
        chart.update(); // グラフを更新
    }

    frameCount++; // フレームカウンターをインクリメント
    animationFrameId = requestAnimationFrame(updateSimulation); // 次のフレームを要求
}

// ロックダウン時のグリッド線を描画する関数
function drawLockdownGrid() {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; // グリッド線の色と透明度
    ctx.lineWidth = 1; // グリッド線の太さ

    const cellWidth = canvas.width / lockdownDivisions;
    const cellHeight = canvas.height / lockdownDivisions;

    // 垂直線を描画
    for (let i = 1; i < lockdownDivisions; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellWidth, 0);
        ctx.lineTo(i * cellWidth, canvas.height);
        ctx.stroke();
    }

    // 水平線を描画
    for (let i = 1; i < lockdownDivisions; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * cellHeight);
        ctx.lineTo(canvas.width, i * cellHeight);
        ctx.stroke();
    }
}

// 統計情報をUIに表示する関数
function updateStatisticsDisplay() {
    document.getElementById('healthyCount').textContent = stats.healthy;
    document.getElementById('vaccinatedCount').textContent = stats.vaccinated_healthy;
    document.getElementById('infectedCount').textContent = stats.infected;
    document.getElementById('vaccinatedInfectedCount').textContent = stats.vaccinated_infected;
    document.getElementById('persistentCount').textContent = stats.persistent;
    document.getElementById('recoveredCount').textContent = stats.recovered;
}

// ============================================================================
// 5. UI要素とイベントリスナー
// ============================================================================

// UI要素の取得
const startButton = document.getElementById('startButton');
const resetButton = document.getElementById('resetButton');

// パラメータスライダーと表示値の同期
const paramElements = [
    { id: 'populationSize', type: 'int' },
    { id: 'initialInfected', type: 'int' },
    { id: 'infectionProbability', type: 'float' },
    { id: 'recoveryTime', type: 'int' },
    { id: 'lockdownTriggerThreshold', type: 'int' },
    { id: 'lockdownDuration', type: 'int' },
    { id: 'lockdownDivisions', type: 'int' },
    { id: 'infectionCheckInterval', type: 'int' },
    { id: 'vaccinationRate', type: 'int' }
];

paramElements.forEach(param => {
    const slider = document.getElementById(param.id);
    const valueSpan = document.getElementById(param.id + 'Value');

    // スライダーの値が変更されたときの処理
    slider.addEventListener('input', () => {
        valueSpan.textContent = slider.value;
        // グローバル変数に値を反映
        if (param.type === 'int') {
            window[param.id] = parseInt(slider.value);
        } else if (param.type === 'float') {
            window[param.id] = parseFloat(slider.value);
        }
    });
});

// シミュレーション開始ボタンのイベントリスナー
startButton.addEventListener('click', () => {
    initSimulation(); // シミュレーションを開始
});

// リセットボタンのイベントリスナー
resetButton.addEventListener('click', () => {
    // アニメーションフレームをキャンセルしてシミュレーションを停止
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    simulationRunning = false; // シミュレーション停止フラグを立てる

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 統計情報をリセットして表示を更新
    stats = {
        healthy: 0,
        vaccinated_healthy: 0,
        infected: 0,
        vaccinated_infected: 0,
        persistent: 0,
        recovered: 0
    };
    updateStatisticsDisplay();

    // グラフをリセット
    if (chart) {
        chart.destroy();
        chartData.labels = [];
        chartData.datasets.forEach(dataset => dataset.data = []);
    }
    // 初期状態のグラフを再描画（データは空）
    const chartCtx = document.getElementById('chartCanvas').getContext('2d');
    chart = new Chart(chartCtx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '時間 (秒)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '人数'
                    },
                    beginAtZero: true,
                    max: populationSize // Y軸の最大値を人口サイズに設定
                }
            }
        }
    });

    // パラメータを初期値に戻す（UIも更新）
    paramElements.forEach(param => {
        const slider = document.getElementById(param.id);
        const valueSpan = document.getElementById(param.id + 'Value');
        // HTMLで設定されている初期値を取得して設定
        const defaultValue = slider.getAttribute('value');
        slider.value = defaultValue;
        valueSpan.textContent = defaultValue;
        // グローバル変数も初期値に戻す
        if (param.type === 'int') {
            window[param.id] = parseInt(defaultValue);
        } else if (param.type === 'float') {
            window[param.id] = parseFloat(defaultValue);
        }
    });

    // ロックダウン状態をリセット
    lockdownActive = false;
    lockdownStartTime = 0;
    frameCount = 0;
});

// ページロード時に一度統計表示を初期化
document.addEventListener('DOMContentLoaded', () => {
    updateStatisticsDisplay();

    // キャンバスのサイズを親要素に合わせて設定
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 初期グラフの描画
    const chartCtx = document.getElementById('chartCanvas').getContext('2d');
    chart = new Chart(chartCtx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '時間 (秒)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '人数'
                    },
                    beginAtZero: true,
                    max: populationSize // Y軸の最大値を人口サイズに設定
                }
            }
        }
    });
});

// キャンバスのサイズを調整する関数
function resizeCanvas() {
    const simulationArea = document.querySelector('.simulation-area');
    canvas.width = simulationArea.clientWidth;
    canvas.height = simulationArea.clientWidth * (3 / 4); // 例: 4:3のアスペクト比を維持
    // 必要に応じて、ここで人の初期位置を再計算することも検討
}
