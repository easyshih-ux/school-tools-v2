// Gate 2 uses fictional records only. Replace this data source in Gate 3.
const MOCK_TEACHERS = Object.freeze([
  { id: 'mock-01', name: '王小明', office: '教務處', title: '測試組長', lineName: '測試帳號01', subject: '測試業務A', ext: 'T-001', inSmallGroup: '已加入' },
  { id: 'mock-02', name: '李小華', office: '學務處', title: '測試教師', lineName: '測試帳號02', subject: '測試業務B', ext: 'T-002', inSmallGroup: '未加入' },
  { id: 'mock-03', name: '陳小美', office: '總務處', title: '測試幹事', lineName: '測試帳號03', subject: '測試業務C', ext: 'T-003', inSmallGroup: '已加入' },
  { id: 'mock-04', name: '林大同', office: '輔導處', title: '測試教師', lineName: '測試帳號04', subject: '測試業務D', ext: 'T-004', inSmallGroup: '未加入' },
  { id: 'mock-05', name: '張怡君', office: '特教辦公室', title: '測試教師', lineName: '測試帳號05', subject: '測試業務E', ext: 'T-005', inSmallGroup: '已加入' },
  { id: 'mock-06', name: '周測試', office: '體育組', title: '測試組員', lineName: '測試帳號06', subject: '測試業務F', ext: 'T-006', inSmallGroup: '未加入' },
  { id: 'mock-07', name: '吳範例', office: '七導辦公室', title: '測試導師', lineName: '測試帳號07', subject: '測試科目A', ext: 'T-007', inSmallGroup: '已加入' },
  { id: 'mock-08', name: '鄭虛構', office: '八導辦公室', title: '測試導師', lineName: '測試帳號08', subject: '測試科目B', ext: 'T-008', inSmallGroup: '未加入' },
  { id: 'mock-09', name: '許樣本', office: '九導辦公室', title: '測試導師', lineName: '測試帳號09', subject: '測試科目C', ext: 'T-009', inSmallGroup: '已加入' },
  { id: 'mock-10', name: '郭示意', office: '其他', title: '測試職稱', lineName: '測試帳號10', subject: '測試業務G', ext: 'T-010', inSmallGroup: '未加入' }
]);

async function loadTeachers() {
  return MOCK_TEACHERS.map((teacher) => ({ ...teacher }));
}

async function updateTeacher(formData) {
  return {
    success: false,
    persisted: false,
    message: 'V2 測試模式：目前不會寫入正式資料。',
    submittedData: { ...formData }
  };
}
