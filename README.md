# 📱 ClaimFlow

> WhatsApp-driven promotion claim management platform: consumers submit receipts, AI-assisted identification, and staff review efficiently.

---

## System introduction

This system is an automated tool designed for Malaysian promotional activities (such as cash rebates on electrical appliances, brand offers, etc.).

**Problems with the Traditional Way:**
- Consumers need to go to the store in person or submit the receipt online
- Staff have to manually check receipt information one by one, which is time-consuming and laborious
- Error-prone and inefficient

**After using this system:**
- Consumers simply send a photo of their receipt using WhatsApp
- AI automatically identifies brands and amounts on receipts
- Staff quickly review the results on their computers and send the results to consumers
- All records are automatically saved and can be checked at any time

---

## Applicable objects

✅ **Event Organizer** - A business or organization that needs to review a large number of consumer receipts
✅ **Brand Side of Promotions** - Cashback activities for brands such as Samsung, Apple, Dyson, etc.
✅ **Marketing Company** - Help clients manage promotions
✅ **Any organization requiring receipt verification**

---

## Main functions

### 📸 Consumer (WhatsApp)

Consumers do not need to install any App and can participate in the event directly using WhatsApp:

| step | what consumers do | What does the system do automatically? |
|------|-------------|---------------|
| 1 | Send ID number | Verify that the format is correct and prompt for next step. |
| 2 | Take and send a photo of your receipt | Confirm receipt of photos, notify and wait for review results |
| 3 | Wait for notification | Receive review results (pass/fail) |

**Features:**
- No need to download an app, just use the familiar WhatsApp
- Simple operation, follow the prompts step by step
- Available for submission 24 hours a day

### 💻 Staff terminal (computer background)

Staff log in to the management backend through a web browser for efficient review:

1. **Login to the background** - Open the management website with a browser, enter your account and password to log in
2. **View Submission Records** - See a list of all consumer submitted receipts
3. **AI Assisted Review** - Click to view the results of AI automatic recognition (brand, amount, confidence level)
4. **One-click reply** - Enter review comments, click send, and consumers will receive notifications on WhatsApp immediately

**Features:**
- Web operation, no need to install software
- AI automatic recognition reduces manual input errors
- Batch processing to improve efficiency
- All operations are recorded and traceable

---

## Review status description

In the admin panel, you will see the review status of each receipt:

| state | meaning | Next steps |
|------|------|-----------|
| 🟡To be extracted by AI | The consumer has submitted the receipt and is waiting for AI recognition | Wait for the system to process it automatically (usually completed within a few seconds) |
| 🔵 Message to be sent | AI recognition has been completed and is waiting for staff review | View the recognition results, enter review comments and send |
| 🟢 Sent | Reviewed and approved, consumers have been notified | No action required, the record has been archived |
| 🔴Rejected | Reviewed but not passed, the consumer has been notified | No action required, you can view the reasons for rejection |

---

## Activity rule settings

You can flexibly set review rules based on activity needs:

**Configurable rules include:**
- **Approved Brand List** - Only receipts from these brands will pass (eg: Samsung, Apple, Dyson, Panasonic, Sony)
- **Minimum Spending Amount** - The receipt amount must reach this amount to meet the requirements (eg: RM 500)
- **Limit on the number of submissions per person per day** - to prevent repeated submissions (e.g.: maximum 5 times per person per day)
- **Submission timeout** - After the consumer sends the ID card, the receipt must be sent within the specified time (eg: 30 minutes)

**How to modify a rule:**
Please contact the system administrator to modify the configuration document. After modification, the system needs to be restarted to take effect.

---

## Data recording and export

The system automatically saves all important data:

### 📊 Automatically generated Excel table

The system maintains two Excel tables to record all activity data:

| table name | Record content | use |
|---------|---------|------|
| **Registrations** | All users participating in the event: mobile phone number, ID number, registration time | Count the number of participants and user information |
| **Receipts** | All submitted receipts: document number, brand, amount, review results, AI recognition accuracy | Financial reconciliation and activity effect analysis |

### 📁 Data backup

The system will automatically back up:
- Pictures of all receipts (for easy review)
- Complete database (contains all operation records)
- Excel export file (can be printed directly or sent to finance)

---

## Frequently Asked Questions (FAQ)

### ❓ Consumer FAQs

**Q: Do I need to download the app?**

A: No need! All you need to participate is WhatsApp on your phone.

**Q: Is my personal information safe?**

A: The system will strictly protect your privacy. The ID number and mobile phone number will only be used for activity review and will not be disclosed to third parties.

**Q: How long does it take to receive the results after submission?**

A: Results are usually available within a few minutes to a few hours. The specific time depends on the review speed of the staff.

**Q: What should I do if the receipt is not clearly photographed?**

A: The system will prompt you to shoot again. Please make sure the photo is clear and well-lit so that the brand name and amount can be seen.

**Q: Can I submit multiple receipts?**

A: Yes, but there is a limit on the number of submissions per person per day (the specific number is determined by the event rules).

### ❓ FAQs from staff

**Q: Do I need to know technology to use it?**

A: No need! The management backend is designed to be very simple and can be operated if you know how to use the web page. If in doubt, please read the operation manual or contact technical support.

**Q: What should I do if the AI recognition is wrong?**

A: AI is just an auxiliary tool, and the final review is in your hands. If the AI recognition is wrong, you can manually modify the brand and amount before sending the review results.

**Q: How to export data to finance?**

A: The system will automatically generate an Excel file, which you can download or print directly. The file path is described in the system settings.

**Q: What should I do if there is a problem with the system?**

A: Please contact your system administrator or technical support. The system has an automatic backup function, so data will not be lost.

**Q: Can multiple people review it at the same time?**

A: Yes! Multiple staff can log in to the backend at the same time and process different receipts without affecting each other.

---

## Things to note

- **Login Credential Security** - Please keep the account and password of the staff properly and do not disclose them to others.
- **Regular Backup** - It is recommended to back up system data regularly to prevent accidental loss.
- **Network Stability** - Please ensure that the network connection is stable when using it to avoid affecting the review efficiency.
- **Train staff** - Before first use, please conduct simple training for staff to ensure they are familiar with the operating procedures

---

## Technical support

If you encounter any problems during use, please contact us through the following methods:

- **Technical Support Email**: [Please fill in your technical support email]
- **Technical support phone number**: [Please enter your technical support phone number]
- **Online Customer Service**: [Please fill in the online customer service link]

---

## Version history

- **Current version**: v1.0
- **Last updated**: June 2026

---

## License

MIT
