const { db, recordAudit } = require('./db');

function seedDemoData() {
  const now = new Date().toISOString();
  const seed = db.transaction(() => {
    const insertSource = db.prepare(`INSERT OR IGNORE INTO source_records (title, entity_type, field_name, current_value, previous_value, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`);
    const insertDependent = db.prepare(`INSERT OR IGNORE INTO dependent_records (record_name, record_type, source_record_id, field_name, stored_value, status, last_updated, created_at)
      VALUES (?, ?, ?, ?, ?, 'CURRENT', ?, ?)`);
    const originalSource = db.prepare('SELECT id FROM source_records WHERE title = ?').get('Semester Examination');
    if (!originalSource) {
      insertSource.run('Semester Examination', 'Examination', 'Exam Date', '15 November 2026', now, now);
      const sourceId = db.prepare('SELECT id FROM source_records WHERE title = ?').get('Semester Examination').id;
      for (const [name, type, value] of [
        ['Examination Timetable', 'Timetable', '15 November 2026'],
        ['Student Notification', 'Notification', '15 November 2026'],
        ['Hall Ticket Record', 'Hall ticket', '15 November 2026'],
        ['Eligibility Report', 'Eligibility report', '14 November 2026']
      ]) insertDependent.run(name, type, sourceId, 'Exam Date', value, now, now);
      recordAudit({ eventType: 'SYSTEM_SEEDED', sourceRecordId: sourceId, message: 'Demonstration records initialized.', details: { dependentRecords: 4 } });
    }

    if (!db.prepare('SELECT id FROM source_records WHERE title = ?').get('Library Renewal Deadline')) {
      insertSource.run('Library Renewal Deadline', 'Library', 'Renewal Date', '20 November 2026', now, now);
      const sourceId = db.prepare('SELECT id FROM source_records WHERE title = ?').get('Library Renewal Deadline').id;
      insertDependent.run('Library Reminder', 'Notification', sourceId, 'Renewal Date', '20 November 2026', now, now);
    }
    seedCollegeDemo(now);
  });
  seed();
  return db.prepare('SELECT id FROM source_records WHERE title = ?').get('Semester Examination')?.id;
}

const moduleDefinitions = [
  ['hall_ticket', 'Hall Ticket', (student) => ({ student_name: student.student_name, roll_number: student.roll_number, examination: 'Semester III University Examination', exam_date: '18 November 2026', exam_center: 'SWEC Main Block' })],
  ['examination_registration', 'Examination Registration', (student) => ({ student_name: student.student_name, registration_number: `EX-${student.roll_number}`, examination: 'Semester III University Examination', semester: student.semester, registration_status: 'Confirmed' })],
  ['attendance_record', 'Attendance Record', (student, index) => ({ student_name: student.student_name, course: 'Data Structures', attendance_percentage: 82 + index, classes_held: 50, classes_attended: 41 + index })],
  ['internal_marks', 'Internal Marks', (student, index) => ({ student_name: student.student_name, course: 'Data Structures', midterm_one: 17 + (index % 4), midterm_two: 18 + (index % 3), maximum_marks: 20 })],
  ['library_membership', 'Library Membership', (student) => ({ student_name: student.student_name, membership_id: `LIB-${student.roll_number}`, membership_status: 'Active', books_checked_out: 2 })],
  ['library_transactions', 'Library Transactions', (student) => ({ student_name: student.student_name, transaction_id: `LTX-${student.roll_number}`, book_title: 'Introduction to Algorithms', issue_date: '2026-10-12', due_date: '2026-11-12', fine_amount: 0 })],
  ['department_student_records', 'Department Student Records', (student) => ({ student_name: student.student_name, department: student.department, year_name: student.year_name, semester: student.semester, roll_number: student.roll_number, academic_year: student.academic_year })],
  ['student_notifications', 'Student Notifications', (student) => ({ student_name: student.student_name, email: student.email, phone: student.phone, channel: 'Email', subject: 'Semester III examination schedule', delivery_status: 'Delivered' })],
  ['fee_records', 'Fee Records', (student) => ({ student_name: student.student_name, academic_year: student.academic_year, total_fee: 85000, paid_amount: 60000, balance: 25000, payment_status: 'Partially paid', receipt_number: `FEE-${student.roll_number}` })]
];

function seedCollegeDemo(now) {
  const students = [
    { student_id: 'SWEC2025CSE042', student_name: 'Ananya Sharma', department: 'CSE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25CSE042', email: 'ananya042@example.com', phone: '+91 90000 10042' },
    { student_id: 'SWEC2025CSE043', student_name: 'Ananya Sharmila', department: 'CSE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25CSE043', email: 'ananya043@example.com', phone: '+91 90000 10043' },
    { student_id: 'SWEC2025ECE018', student_name: 'Rohan Mehta', department: 'ECE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25ECE018', email: 'rohan018@example.com', phone: '+91 90000 10018' },
    { student_id: 'SWEC2025EEE031', student_name: 'Isha Reddy', department: 'EEE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25EEE031', email: 'isha031@example.com', phone: '+91 90000 10031' },
    { student_id: 'SWEC2025CIV012', student_name: 'Kabir Rao', department: 'Civil Engineering', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25CIV012', email: 'kabir012@example.com', phone: '+91 90000 10012' },
    { student_id: 'SWEC2025CSE055', student_name: 'Meera Nair', department: 'CSE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25CSE055', email: 'meera055@example.com', phone: '+91 90000 10055' },
    { student_id: 'SWEC2025MECH009', student_name: 'Arjun Patel', department: 'Mechanical Engineering', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25MEC009', email: 'arjun009@example.com', phone: '+91 90000 10009' },
    { student_id: 'SWEC2025IT026', student_name: 'Diya Kapoor', department: 'Information Technology', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25IT026', email: 'diya026@example.com', phone: '+91 90000 10026' },
    { student_id: 'SWEC2025CSE061', student_name: 'Vikram Desai', department: 'CSE', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25CSE061', email: 'vikram061@example.com', phone: '+91 90000 10061' },
    { student_id: 'SWEC2025AIML014', student_name: 'Sara Thomas', department: 'AI & Machine Learning', academic_year: '2026–2027', year_name: 'II Year', semester: 'III Semester', roll_number: '25AIML014', email: 'sara014@example.com', phone: '+91 90000 10014' },
    { student_id: 'SWEC2024CSE077', student_name: 'Ananya Sharma', department: 'CSE', academic_year: '2025–2026', year_name: 'III Year', semester: 'V Semester', roll_number: '24CSE077', email: 'ananya077@example.com', phone: '+91 90000 10077' }
  ];
  const insertStudent = db.prepare(`INSERT OR IGNORE INTO college_students
    (student_id, college_name, student_name, department, academic_year, year_name, semester, roll_number, email, phone, created_at, updated_at)
    VALUES (@student_id, 'SWEC Demo College', @student_name, @department, @academic_year, @year_name, @semester, @roll_number, @email, @phone, @now, @now)`);
  const insertRecord = db.prepare(`INSERT OR IGNORE INTO college_records
    (student_id, module_key, module_name, record_key, data_json, created_at, updated_at)
    VALUES (?, ?, ?, 'primary', ?, ?, ?)`);
  students.forEach((student, studentIndex) => {
    insertStudent.run({ ...student, now });
    for (const [moduleKey, moduleName, buildData] of moduleDefinitions) {
      const recordData = { ...buildData(student, studentIndex), student_id: student.student_id };
      insertRecord.run(student.student_id, moduleKey, moduleName, JSON.stringify(recordData), now, now);
    }
  });
  const seeded = db.prepare("SELECT id FROM college_audit_events WHERE event_type = 'COLLEGE_DEMO_SEEDED' LIMIT 1").get();
  if (!seeded) {
    const target = students[0];
    db.prepare(`INSERT INTO college_audit_events (student_id, event_type, message, details_json, created_at)
      VALUES (?, 'COLLEGE_DEMO_SEEDED', ?, ?, ?)`)
      .run(target.student_id, 'Fictional college student test dataset initialized.', JSON.stringify({ students: students.length, modulesPerStudent: moduleDefinitions.length }), now);
  }
}

module.exports = { seedDemoData, moduleDefinitions };
