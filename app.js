import { AIEngine } from './ai-engine.js';
import { NotificationService } from './notification-service.js';

class App {
    constructor() {
        this.state = {
            profile: JSON.parse(localStorage.getItem('swasthaProfile')) || null,
            logs: JSON.parse(localStorage.getItem('swasthaLogs')) || []
        };
        
        this.aiEngine = new AIEngine();
        this.notificationService = new NotificationService();
        
        this.initUI();
        this.bindEvents();
        
        if (this.state.profile) {
            this.showScreen('dashboardScreen');
            this.loadDashboardData();
        } else {
            this.showScreen('disclaimerScreen');
        }

        // Initialize AI
        this.aiEngine.init((msg, type) => this.updateAIStatus(msg, type));
        
        // Start background services
        this.notificationService.scheduleHydrationReminder();
        this.notificationService.scheduleDailyCheck();
    }

    initUI() {
        this.screens = document.querySelectorAll('.screen');
        this.aiStatusBadge = document.getElementById('ai-status');
        this.sidebar = document.getElementById('sidebar');
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Update active class
                document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
                e.currentTarget.classList.add('active');

                this.showScreen(e.currentTarget.getAttribute('data-target'));
                if (window.innerWidth <= 768) {
                    this.sidebar.classList.remove('open');
                }
            });
        });

        document.getElementById('menu-toggle').addEventListener('click', () => {
            this.sidebar.classList.toggle('open');
        });

        // Disclaimer
        document.getElementById('accept-disclaimer').addEventListener('click', () => {
            this.showScreen('profileScreen');
        });

        // Profile Form
        document.getElementById('profile-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.state.profile = {
                name: document.getElementById('prof-name').value,
                age: document.getElementById('prof-age').value,
                city: document.getElementById('prof-city').value,
                conditions: document.getElementById('prof-conditions').value
            };
            localStorage.setItem('swasthaProfile', JSON.stringify(this.state.profile));
            this.showScreen('dashboardScreen');
            this.loadDashboardData();
        });

        // Backup & Restore
        document.getElementById('backup-btn').addEventListener('click', (e) => {
            e.preventDefault();
            this.backupData();
        });

        document.getElementById('restore-upload').addEventListener('change', (e) => {
            this.restoreData(e);
        });

        // Symptom Analysis
        document.getElementById('analyze-btn').addEventListener('click', async () => {
            const text = document.getElementById('symptom-input').value;
            if (!text) return;
            
            const btn = document.getElementById('analyze-btn');
            btn.textContent = 'Analyzing...';
            btn.disabled = true;

            const results = await this.aiEngine.analyzeSymptoms(text);
            this.renderAnalysisResults(results);

            btn.textContent = 'Analyze';
            btn.disabled = false;
        });

        // Daily Log Form
        document.getElementById('daily-log-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const log = {
                date: new Date().toISOString().split('T')[0],
                fatigue: parseInt(document.getElementById('log-fatigue').value),
                sleep: parseInt(document.getElementById('log-sleep').value),
                exertion: parseInt(document.getElementById('log-exertion').value)
            };
            
            // Update or add today's log
            const existingIndex = this.state.logs.findIndex(l => l.date === log.date);
            if (existingIndex >= 0) {
                this.state.logs[existingIndex] = log;
            } else {
                this.state.logs.push(log);
            }
            
            localStorage.setItem('swasthaLogs', JSON.stringify(this.state.logs));
            this.drawCharts();
            alert('Log saved successfully!');
            e.target.reset();
        });
    }

    showScreen(screenId) {
        this.screens.forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        
        if (screenId === 'profileScreen' && this.state.profile) {
            document.getElementById('prof-name').value = this.state.profile.name || '';
            document.getElementById('prof-age').value = this.state.profile.age || '';
            document.getElementById('prof-city').value = this.state.profile.city || '';
            document.getElementById('prof-conditions').value = this.state.profile.conditions || '';
        }
    }

    backupData() {
        const data = {
            profile: this.state.profile,
            logs: this.state.logs
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swasthanet-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    restoreData(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.profile) {
                    localStorage.setItem('swasthaProfile', JSON.stringify(data.profile));
                    this.state.profile = data.profile;
                }
                if (data.logs) {
                    localStorage.setItem('swasthaLogs', JSON.stringify(data.logs));
                    this.state.logs = data.logs;
                }
                alert('Data restored successfully!');
                
                // Reset file input
                event.target.value = '';
                
                if (this.state.profile) {
                    this.showScreen('dashboardScreen');
                    this.loadDashboardData();
                }
            } catch (err) {
                alert('Invalid backup file. Please ensure it is a valid SwasthaNet JSON backup.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    }

    updateAIStatus(msg, type) {
        this.aiStatusBadge.textContent = msg;
        this.aiStatusBadge.className = `badge ${type}`;
    }

    async loadDashboardData() {
        this.drawCharts();
        await this.fetchEnvironmentalData();
    }

    async fetchEnvironmentalData() {
        const envDiv = document.getElementById('env-data');
        const warnDiv = document.getElementById('env-warnings');
        envDiv.innerHTML = 'Fetching data...';
        
        try {
            // 1. Geocode city
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(this.state.profile.city)}&count=1`);
            const geoData = await geoRes.json();
            
            if (!geoData.results || geoData.results.length === 0) {
                throw new Error("City not found");
            }
            
            const { latitude, longitude, name } = geoData.results[0];

            // 2. Fetch Weather & AQI
            const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m`);
            const weatherData = await weatherRes.json();
            
            const aqiRes = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi`);
            const aqiData = await aqiRes.json();

            const currentTemp = weatherData.current.temperature_2m;
            const currentHumidity = weatherData.current.relative_humidity_2m;
            const currentAqi = aqiData.current.us_aqi;

            envDiv.innerHTML = `
                <p><strong>Location:</strong> ${name}</p>
                <p><strong>Temperature:</strong> ${currentTemp}°C</p>
                <p><strong>Humidity:</strong> ${currentHumidity}%</p>
                <p><strong>AQI (US):</strong> ${currentAqi}</p>
            `;

            const risk = this.aiEngine.calculateEnvironmentalRisk({
                temperature: currentTemp,
                aqi: currentAqi
            }, this.state.profile);

            if (risk.warnings.length > 0) {
                warnDiv.innerHTML = risk.warnings.map(w => {
                    const badgeClass = w.severity === 'High' ? 'danger' : 'warning';
                    const borderColor = w.severity === 'High' ? 'var(--danger)' : 'var(--warning)';
                    return `
                        <div class="result-item" style="border-color: ${borderColor}">
                            <span class="badge ${badgeClass}">${w.severity} Risk</span>
                            <p style="margin-top: 8px;">${w.message}</p>
                        </div>
                    `;
                }).join('');
                
                if (risk.level === 'High') {
                    // Send notification for the first high risk warning
                    const highRisk = risk.warnings.find(w => w.severity === 'High');
                    if (highRisk) {
                        this.notificationService.sendImmediateAlert('High Environmental Risk', highRisk.message);
                    }
                }
            } else {
                warnDiv.innerHTML = '<p style="color: var(--safe); margin-top: 10px;">Conditions are currently safe.</p>';
            }

        } catch (error) {
            console.error(error);
            envDiv.innerHTML = 'Failed to load environmental data. Please check your city name or internet connection.';
        }
    }

    renderAnalysisResults(results) {
        const container = document.getElementById('analysis-results');
        container.innerHTML = '';

        results.forEach(res => {
            const probPercent = Math.round(res.probability * 100);
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `
                <h3>${res.condition} <span class="badge ${probPercent > 70 ? 'danger' : 'warning'}">${probPercent}%</span></h3>
                <p><strong>Detected:</strong> ${res.matchedSymptoms ? res.matchedSymptoms.join(', ') : 'N/A'}</p>
                <p><strong>Advice:</strong> ${res.advice}</p>
                <div class="prob-bar-container">
                    <div class="prob-bar" style="width: 0%"></div>
                </div>
            `;
            container.appendChild(div);

            // Animate bar
            setTimeout(() => {
                div.querySelector('.prob-bar').style.width = `${probPercent}%`;
            }, 100);
        });
    }

    // --- CANVAS CHARTING LOGIC ---
    drawCharts() {
        if (this.state.logs.length === 0) return;
        
        // Get last 7 days
        const data = this.state.logs.slice(-7);
        const labels = data.map(d => d.date.substring(5)); // MM-DD
        
        this.drawSingleLineChart('fatigueChart', labels, data.map(d => d.fatigue), 'Fatigue Level (1-10)', '#ef4444');
        this.drawSingleLineChart('sleepChart', labels, data.map(d => d.sleep), 'Sleep Hours', '#3b82f6');
        this.drawDualLineChart('exertionChart', labels, data.map(d => d.exertion), data.map(d => d.sleep), 'Exertion vs Sleep');
    }

    drawSingleLineChart(canvasId, labels, dataPoints, title, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        // Handle high-DPI displays
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const width = rect.width;
        const height = rect.height;
        const padding = 40;

        ctx.clearRect(0, 0, width, height);

        // Title
        ctx.fillStyle = '#0f172a';
        ctx.font = '14px sans-serif';
        ctx.fillText(title, 10, 20);

        if (dataPoints.length < 2) {
            ctx.fillText("Not enough data", width/2 - 40, height/2);
            return;
        }

        const maxVal = Math.max(...dataPoints, 10);
        const minVal = 0;

        const getX = (index) => padding + (index * ((width - padding * 2) / (dataPoints.length - 1)));
        const getY = (val) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - padding * 2);

        // Draw axes
        ctx.beginPath();
        ctx.strokeStyle = '#cbd5e1';
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        dataPoints.forEach((val, i) => {
            if (i === 0) ctx.moveTo(getX(i), getY(val));
            else ctx.lineTo(getX(i), getY(val));
        });
        ctx.stroke();

        // Draw points and labels
        ctx.fillStyle = color;
        dataPoints.forEach((val, i) => {
            ctx.beginPath();
            ctx.arc(getX(i), getY(val), 4, 0, Math.PI * 2);
            ctx.fill();
            
            // X-axis label
            ctx.fillStyle = '#475569';
            ctx.font = '10px sans-serif';
            ctx.fillText(labels[i], getX(i) - 10, height - padding + 15);
        });
    }

    drawDualLineChart(canvasId, labels, data1, data2, title) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const width = rect.width;
        const height = rect.height;
        const padding = 40;

        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = '#0f172a';
        ctx.font = '14px sans-serif';
        ctx.fillText(title, 10, 20);
        
        // Legend
        ctx.fillStyle = '#f59e0b';
        ctx.fillText("Exertion", width - 130, 20);
        ctx.fillStyle = '#3b82f6';
        ctx.fillText("Sleep", width - 60, 20);

        if (data1.length < 2) return;

        const maxVal = Math.max(...data1, ...data2, 10);
        const minVal = 0;

        const getX = (index) => padding + (index * ((width - padding * 2) / (data1.length - 1)));
        const getY = (val) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - padding * 2);

        // Draw axes
        ctx.beginPath();
        ctx.strokeStyle = '#cbd5e1';
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw Line 1 (Exertion)
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        data1.forEach((val, i) => {
            if (i === 0) ctx.moveTo(getX(i), getY(val));
            else ctx.lineTo(getX(i), getY(val));
        });
        ctx.stroke();

        // Draw Line 2 (Sleep)
        ctx.beginPath();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        data2.forEach((val, i) => {
            if (i === 0) ctx.moveTo(getX(i), getY(val));
            else ctx.lineTo(getX(i), getY(val));
        });
        ctx.stroke();
        
        // X-axis labels
        ctx.fillStyle = '#475569';
        ctx.font = '10px sans-serif';
        labels.forEach((label, i) => {
            ctx.fillText(label, getX(i) - 10, height - padding + 15);
        });
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
