class FastingService {
    /**
     * Check if a specific date (or tomorrow) is a fasting day
     * @param {Date} date - The date to check (default: tomorrow)
     */
    static checkFastingDay(date = new Date()) {
        // We usually want to check for *tomorrow* to remind *today*
        const targetDate = new Date(date);
        targetDate.setDate(targetDate.getDate() + 1);

        const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 4 = Thursday

        const isMonday = dayOfWeek === 1;
        const isThursday = dayOfWeek === 4;

        // Hijri check using Intl API (more reliable than hijri-date package)
        let hijriDay, hijriMonth, hijriYear;
        try {
            const formatter = new Intl.DateTimeFormat('en-TN-u-ca-islamic', {
                day: 'numeric',
                month: 'numeric',
                year: 'numeric'
            });
            const parts = formatter.formatToParts(targetDate);
            hijriDay = parseInt(parts.find(p => p.type === 'day').value);
            hijriMonth = parseInt(parts.find(p => p.type === 'month').value);
            hijriYear = parseInt(parts.find(p => p.type === 'year').value);
        } catch (e) {
            console.error('Error calculating Hijri date:', e);
            // Fallback or safe defaults
            hijriDay = 0; hijriMonth = 0; hijriYear = 0;
        }

        // White days are 13, 14, 15
        const isWhiteDay = [13, 14, 15].includes(hijriDay);

        // Ashura (10th of Muharram - Month 1)
        const isAshura = (hijriMonth === 1 && hijriDay === 10);

        // Arafah (9th of Dhul Hijjah - Month 12)
        const isArafah = (hijriMonth === 12 && hijriDay === 9);

        return {
            date: targetDate,
            hijriDate: `${hijriDay}/${hijriMonth}/${hijriYear}`,
            isMonday,
            isThursday,
            isWhiteDay,
            isAshura,
            isArafah
        };
    }

    /**
     * Get the reminder message for the fasting type
     */
    static getReminderMessage(type) {
        const messages = {
            monday: "🌙 تذكير: غداً يوم الإثنين، سنة عن النبي ﷺ صيام هذا اليوم.",
            thursday: "🌙 تذكير: غداً يوم الخميس، ترفع فيه الأعمال، ويستحب الصيام فيه.",
            white_days: "🌕 تذكير: غداً من الأيام البيض، أوصى النبي ﷺ بصيامها.",
            ashura: "🌟 تذكير: غداً يوم عاشوراء، يكفر السنة الماضية.",
            arafah: "⛰️ تذكير: غداً يوم عرفة، صومه يكفر السنة الماضية والباقية."
        };
        return messages[type];
    }
}

module.exports = FastingService;
