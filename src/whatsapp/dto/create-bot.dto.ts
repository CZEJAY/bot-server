import { IsString, IsObject, IsOptional } from 'class-validator';

export class CreateBotDto {
  @IsString()
  name: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}
