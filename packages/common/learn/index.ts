export interface ResultLearn {
    dayNumber?: number;
    wordNumber: number;//返回更新完成之后单词的数量
}
export interface StudyStats {
    wordNumber: number;
    dayNumber: number;
    checkedInToday: boolean;
    studyDate: string;
    timezone: 'Asia/Shanghai';
}
