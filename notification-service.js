export class NotificationService {
    constructor() {
        this.hasPermission = false;
        this.checkPermission();
    }

    async checkPermission() {
        if (!('Notification' in window)) {
            console.warn('This browser does not support desktop notification');
            return;
        }
        if (Notification.permission === 'granted') {
            this.hasPermission = true;
        } else if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            this.hasPermission = permission === 'granted';
        }
    }

    sendImmediateAlert(title, body) {
        if (this.hasPermission) {
            new Notification(title, {
                body: body,
                icon: '/favicon.ico' // Placeholder
            });
        } else {
            console.log(`[Notification Fallback] ${title}: ${body}`);
        }
    }

    scheduleHydrationReminder() {
        // Every 2 hours (7200000 ms)
        setInterval(() => {
            this.sendImmediateAlert('Hydration Reminder', 'Time to drink a glass of water!');
        }, 7200000);
    }

    scheduleDailyCheck() {
        // Simple daily check simulation (every 24 hours)
        setInterval(() => {
            this.sendImmediateAlert('Daily Health Check', 'Please log your fatigue and sleep for today.');
        }, 86400000);
    }
}
